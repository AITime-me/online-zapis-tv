#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/production-ops-common.sh
source "${SCRIPT_DIR}/lib/production-ops-common.sh"

PROXY_HELP=0
PROXY_INSTALL=0

readonly PRODUCTION_PUBLIC_DOMAIN="tvoio-vremya.ru"
readonly PRODUCTION_PUBLIC_AUTH_URL="https://tvoio-vremya.ru"
readonly PRODUCTION_PUBLIC_IPV4="72.56.0.12"
readonly PRODUCTION_CADDYFILE_SRC="deploy/caddy/Caddyfile.production"
readonly PRODUCTION_CADDYFILE_DST="/etc/caddy/Caddyfile"
readonly PRODUCTION_CADDY_BACKUP_DIR="/var/backups/online-zapis-tv-production-caddy"
readonly PRODUCTION_HTTPS_HEALTH_URL="https://tvoio-vremya.ru/api/health"
readonly PRODUCTION_HTTPS_RUNBOOK="docs/operations/production-https.md"

CADDY_BACKUP_PATH=""
HAD_PREVIOUS_CADDYFILE=0
INSTALLED_NEW_CADDYFILE=0

usage() {
  cat <<'EOF'
Usage: scripts/ops/install-production-reverse-proxy.sh [--dry-run | --install] [--help]

Install the repository Caddyfile for production HTTPS reverse proxy.
Does NOT install the Caddy package, change DNS, or open firewall ports.

Options:
  --dry-run   Validate checkout/env and print plan only (default)
  --install   Install Caddyfile after confirmation (requires sudo + DNS)
  --help      Show this help

Confirmation phrase (case-sensitive):
  INSTALL PRODUCTION REVERSE PROXY

Requires: production checkout /opt/online-zapis-tv-production, Caddy already
installed from the official Ubuntu package. See docs/operations/production-https.md.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
          ops_die "duplicate --dry-run"
        fi
        OPS_DRY_RUN=1
        ;;
      --install)
        if [[ "$PROXY_INSTALL" -eq 1 ]]; then
          ops_die "duplicate --install"
        fi
        PROXY_INSTALL=1
        ;;
      --help|-h)
        if [[ "$PROXY_HELP" -eq 1 ]]; then
          ops_die "duplicate --help"
        fi
        PROXY_HELP=1
        ;;
      *)
        ops_die "unknown argument: $1"
        ;;
    esac
    shift
  done

  if [[ "$PROXY_HELP" -eq 1 ]]; then
    if [[ "$OPS_DRY_RUN" -eq 1 || "$PROXY_INSTALL" -eq 1 ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi

  if [[ "$PROXY_INSTALL" -eq 1 && "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_die "--install cannot be combined with --dry-run"
  fi

  if [[ "$PROXY_INSTALL" -eq 0 ]]; then
    OPS_DRY_RUN=1
  fi
}

assert_exact_production_proxy_env() {
  local auth_url trust_proxy app_env

  ops_validate_production_env_file

  app_env="$(ops_read_env_value APP_ENV "$PRODUCTION_ENV_FILE" || true)"
  if [[ "$app_env" != "production" ]]; then
    ops_die "APP_ENV must be exactly production"
  fi

  auth_url="$(ops_read_env_value AUTH_URL "$PRODUCTION_ENV_FILE" || true)"
  if [[ "$auth_url" != "$PRODUCTION_PUBLIC_AUTH_URL" ]]; then
    ops_die "AUTH_URL must be exactly ${PRODUCTION_PUBLIC_AUTH_URL} (got a non-matching value)"
  fi

  trust_proxy="$(ops_read_env_value TRUST_PROXY_HEADERS "$PRODUCTION_ENV_FILE" || true)"
  if ! ops_is_true "$trust_proxy"; then
    ops_die "TRUST_PROXY_HEADERS must be true"
  fi
}

assert_caddy_installed() {
  if ! command -v caddy >/dev/null 2>&1; then
    ops_die "caddy command not found. Install Caddy from the official Ubuntu package first (see ${PRODUCTION_HTTPS_RUNBOOK}). This helper does not install packages."
  fi
}

assert_source_caddyfile() {
  local src="${OPS_REPO_ROOT}/${PRODUCTION_CADDYFILE_SRC}"
  [[ -f "$src" ]] || ops_die "missing ${PRODUCTION_CADDYFILE_SRC}"
  if ! grep -q '127\.0\.0\.1:3100' "$src"; then
    ops_die "${PRODUCTION_CADDYFILE_SRC} must proxy to 127.0.0.1:3100"
  fi
  if grep -qE '127\.0\.0\.1:3000|on_demand' "$src" || grep -q 'staging_internal\|staging-app\|\.env\.staging' "$src"; then
    ops_die "${PRODUCTION_CADDYFILE_SRC} contains forbidden staging/on-demand content"
  fi
}

validate_caddyfile() {
  local path="$1"
  ops_info "Validating Caddyfile: ${path}"
  caddy validate --config "$path" --adapter caddyfile
}

local_app_health_ok() {
  ops_check_http_health_production
}

https_health_ok() {
  local body
  body="$(curl -fsS --max-time 20 "$PRODUCTION_HTTPS_HEALTH_URL" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    return 1
  fi
  grep -q '"ok":true' <<<"$body" && grep -q '"status":"healthy"' <<<"$body"
}

# Возвращает имя процесса, слушающего TCP-порт (пусто — никто).
listener_process_for_port() {
  local port="$1"
  local line
  if ! command -v ss >/dev/null 2>&1; then
    ops_die "ss command is required to inspect port ${port}"
  fi
  line="$(ss -ltnp "( sport = :${port} )" 2>/dev/null | tail -n +2 | head -n 1 || true)"
  if [[ -z "$line" ]]; then
    printf ''
    return 0
  fi
  if [[ "$line" =~ users:\(\(\"([^\"]+)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  printf 'unknown'
}

assert_http_ports_safe() {
  local proc80 proc443
  proc80="$(listener_process_for_port 80)"
  proc443="$(listener_process_for_port 443)"

  if [[ -n "$proc80" && "$proc80" != "caddy" ]]; then
    ops_die "port 80 is used by '${proc80}' (not caddy). Refusing to change anything automatically — free the port manually."
  fi
  if [[ -n "$proc443" && "$proc443" != "caddy" ]]; then
    ops_die "port 443 is used by '${proc443}' (not caddy). Refusing to change anything automatically — free the port manually."
  fi
  ops_info "Ports 80/443: free or owned by caddy"
}

resolve_ipv4_addresses() {
  local name="$1"
  local out=""
  if command -v dig >/dev/null 2>&1; then
    out="$(dig +short A "$name" 2>/dev/null | grep -E '^[0-9.]+$' || true)"
  elif command -v getent >/dev/null 2>&1; then
    out="$(getent ahostsv4 "$name" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  else
    ops_die "need dig or getent to resolve DNS for ${name}"
  fi
  printf '%s' "$out"
}

assert_dns_points_to_production() {
  local apex_ips www_ips

  ops_info "Checking DNS A records for ${PRODUCTION_PUBLIC_DOMAIN} and www..."
  apex_ips="$(resolve_ipv4_addresses "$PRODUCTION_PUBLIC_DOMAIN")"
  www_ips="$(resolve_ipv4_addresses "www.${PRODUCTION_PUBLIC_DOMAIN}")"

  if [[ -z "$apex_ips" ]]; then
    ops_die "no A record for ${PRODUCTION_PUBLIC_DOMAIN}; create A @ → ${PRODUCTION_PUBLIC_IPV4} first (see ${PRODUCTION_HTTPS_RUNBOOK})"
  fi
  if ! grep -qxF "$PRODUCTION_PUBLIC_IPV4" <<<"$apex_ips"; then
    ops_die "${PRODUCTION_PUBLIC_DOMAIN} A record must include ${PRODUCTION_PUBLIC_IPV4}"
  fi

  if [[ -z "$www_ips" ]]; then
    ops_die "no IPv4 for www.${PRODUCTION_PUBLIC_DOMAIN}; create CNAME www → ${PRODUCTION_PUBLIC_DOMAIN} or A www → ${PRODUCTION_PUBLIC_IPV4}"
  fi
  if ! grep -qxF "$PRODUCTION_PUBLIC_IPV4" <<<"$www_ips"; then
    ops_die "www.${PRODUCTION_PUBLIC_DOMAIN} must resolve to ${PRODUCTION_PUBLIC_IPV4}"
  fi

  ops_info "DNS IPv4 OK (AAAA not required on this stage)"
}

print_plan() {
  ops_info "=== Production reverse proxy install plan ==="
  ops_info "  domain: https://${PRODUCTION_PUBLIC_DOMAIN}"
  ops_info "  www: permanent redirect → https://${PRODUCTION_PUBLIC_DOMAIN}{uri}"
  ops_info "  upstream: 127.0.0.1:3100 (production app only)"
  ops_info "  source: ${OPS_REPO_ROOT}/${PRODUCTION_CADDYFILE_SRC}"
  ops_info "  target: ${PRODUCTION_CADDYFILE_DST}"
  ops_info "  AUTH_URL required: ${PRODUCTION_PUBLIC_AUTH_URL}"
  ops_info "  TRUST_PROXY_HEADERS required: true"
  ops_info "  DNS expected A: ${PRODUCTION_PUBLIC_IPV4}"
  ops_info "  does NOT: package install, DNS edits, firewall, stop foreign processes"
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Mode: DRY-RUN (no backup, lock, file writes, or systemctl)"
  else
    ops_info "Mode: INSTALL (confirmation + lock + backup + reload)"
  fi
}

restore_previous_caddyfile() {
  if [[ "$INSTALLED_NEW_CADDYFILE" -ne 1 ]]; then
    return 0
  fi

  ops_warn "Attempting Caddyfile rollback..."
  if [[ "$HAD_PREVIOUS_CADDYFILE" -eq 1 && -n "$CADDY_BACKUP_PATH" && -f "$CADDY_BACKUP_PATH" ]]; then
    sudo cp -- "$CADDY_BACKUP_PATH" "$PRODUCTION_CADDYFILE_DST"
  elif [[ "$HAD_PREVIOUS_CADDYFILE" -eq 0 ]]; then
    sudo rm -f -- "$PRODUCTION_CADDYFILE_DST"
    ops_warn "Removed newly installed Caddyfile (no prior file existed)"
    INSTALLED_NEW_CADDYFILE=0
    return 0
  else
    ops_warn "cannot rollback Caddyfile: backup missing"
    return 1
  fi

  if ! sudo caddy validate --config "$PRODUCTION_CADDYFILE_DST" --adapter caddyfile; then
    ops_warn "rollback validate failed"
    return 1
  fi
  if ! sudo systemctl reload caddy; then
    ops_warn "rollback reload failed"
    return 1
  fi
  INSTALLED_NEW_CADDYFILE=0
  ops_info "Previous Caddyfile restored and reloaded"
  return 0
}

fail_after_install() {
  local message="$1"
  restore_previous_caddyfile || true
  ops_die "${message}; previous config restore attempted"
}

apply_install() {
  local src="${OPS_REPO_ROOT}/${PRODUCTION_CADDYFILE_SRC}"
  local ts tmp_path

  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  CADDY_BACKUP_PATH="${PRODUCTION_CADDY_BACKUP_DIR}/${ts}_Caddyfile.bak"

  validate_caddyfile "$src"
  assert_http_ports_safe
  assert_dns_points_to_production

  if ! local_app_health_ok; then
    ops_die "local production health failed at ${PRODUCTION_HEALTH_URL} before install"
  fi

  sudo mkdir -p -- "$PRODUCTION_CADDY_BACKUP_DIR"
  if [[ -f "$PRODUCTION_CADDYFILE_DST" ]]; then
    sudo cp -- "$PRODUCTION_CADDYFILE_DST" "$CADDY_BACKUP_PATH"
    HAD_PREVIOUS_CADDYFILE=1
    ops_info "Backed up existing Caddyfile to ${CADDY_BACKUP_PATH}"
  else
    HAD_PREVIOUS_CADDYFILE=0
    ops_info "No existing ${PRODUCTION_CADDYFILE_DST}; no prior content backup"
  fi

  tmp_path="$(mktemp)"
  cp -- "$src" "$tmp_path"
  sudo install -m 644 "$tmp_path" "${PRODUCTION_CADDYFILE_DST}.new"
  rm -f -- "$tmp_path"
  sudo mv -f -- "${PRODUCTION_CADDYFILE_DST}.new" "$PRODUCTION_CADDYFILE_DST"
  INSTALLED_NEW_CADDYFILE=1

  if ! sudo caddy validate --config "$PRODUCTION_CADDYFILE_DST" --adapter caddyfile; then
    fail_after_install "installed Caddyfile failed validate"
  fi

  if ! sudo systemctl reload caddy; then
    fail_after_install "systemctl reload caddy failed"
  fi

  if ! local_app_health_ok; then
    fail_after_install "local health failed after reload"
  fi

  if ! https_health_ok; then
    fail_after_install "HTTPS health failed after reload"
  fi

  ops_info "Production reverse proxy install complete"
  if [[ "$HAD_PREVIOUS_CADDYFILE" -eq 1 ]]; then
    ops_info "  backup: ${CADDY_BACKUP_PATH}"
  fi
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_assert_production_checkout
  assert_source_caddyfile
  assert_exact_production_proxy_env
  assert_caddy_installed
  print_plan

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    validate_caddyfile "${OPS_REPO_ROOT}/${PRODUCTION_CADDYFILE_SRC}"
    ops_info "Dry-run complete — no lock, backup, file writes, or systemctl."
    exit 0
  fi

  ops_acquire_production_ops_lock
  ops_require_interactive_confirmation "INSTALL PRODUCTION REVERSE PROXY" \
    "Type INSTALL PRODUCTION REVERSE PROXY to continue:"

  apply_install
}

main "$@"
