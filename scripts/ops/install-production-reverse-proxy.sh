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
readonly PRODUCTION_HTTPS_WWW_HEALTH_URL="https://www.tvoio-vremya.ru/api/health"
readonly PRODUCTION_HTTPS_RUNBOOK="docs/operations/production-https.md"
readonly PRODUCTION_HTTPS_HEALTH_DEADLINE_SEC=180
readonly PRODUCTION_HTTPS_HEALTH_INTERVAL_SEC=3
readonly PRODUCTION_HTTPS_CURL_TIMEOUT_SEC=10

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

# Одна попытка HTTPS health (ожидаемый JSON ok=true, status=healthy).
https_health_ok() {
  local body
  body="$(curl -fsS --max-time "$PRODUCTION_HTTPS_CURL_TIMEOUT_SEC" "$PRODUCTION_HTTPS_HEALTH_URL" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    return 1
  fi
  grep -q '"ok":true' <<<"$body" && grep -q '"status":"healthy"' <<<"$body"
}

# Ждёт первый успешный HTTPS health до deadline (ACME/TLS может занять минуты).
# Не вызывает rollback — только return 0/1.
wait_for_https_health() {
  local deadline_at attempt=0 remaining

  deadline_at=$((SECONDS + PRODUCTION_HTTPS_HEALTH_DEADLINE_SEC))
  ops_info "Waiting for HTTPS health at ${PRODUCTION_HTTPS_HEALTH_URL} (deadline ${PRODUCTION_HTTPS_HEALTH_DEADLINE_SEC}s, every ${PRODUCTION_HTTPS_HEALTH_INTERVAL_SEC}s)..."

  while (( SECONDS < deadline_at )); do
    attempt=$((attempt + 1))
    if https_health_ok; then
      ops_info "HTTPS health OK (attempt ${attempt})"
      return 0
    fi

    remaining=$((deadline_at - SECONDS))
    if (( remaining <= 0 )); then
      break
    fi

    ops_info "HTTPS not ready yet (attempt ${attempt}, ~${remaining}s left) — waiting for TLS certificate..."
    if (( remaining < PRODUCTION_HTTPS_HEALTH_INTERVAL_SEC )); then
      sleep "$remaining"
    else
      sleep "$PRODUCTION_HTTPS_HEALTH_INTERVAL_SEC"
    fi
  done

  ops_warn "HTTPS health deadline exceeded after ${attempt} attempt(s)"
  return 1
}

# www → apex permanent redirect на канонический https://tvoio-vremya.ru{uri}.
assert_www_canonical_redirect() {
  local code location expected_prefix

  expected_prefix="https://${PRODUCTION_PUBLIC_DOMAIN}/"
  ops_info "Checking www permanent redirect to ${expected_prefix}..."

  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$PRODUCTION_HTTPS_CURL_TIMEOUT_SEC" "$PRODUCTION_HTTPS_WWW_HEALTH_URL" 2>/dev/null || true)"
  location="$(
    curl -sSI --max-time "$PRODUCTION_HTTPS_CURL_TIMEOUT_SEC" "$PRODUCTION_HTTPS_WWW_HEALTH_URL" 2>/dev/null \
      | tr -d '\r' \
      | awk 'BEGIN{IGNORECASE=1} /^[Ll]ocation:/ {print $2; exit}'
  )"

  if [[ "$code" != "301" ]]; then
    ops_warn "www redirect expected HTTP 301, got '${code:-empty}'"
    return 1
  fi
  if [[ -z "$location" || "$location" != "${expected_prefix}"* ]]; then
    ops_warn "www Location must start with ${expected_prefix} (got '${location:-empty}')"
    return 1
  fi

  ops_info "www canonical redirect OK (${code} → ${location})"
  return 0
}

# Извлекает имена процессов из вывода `ss -p` (Ubuntu: users:(("caddy",pid=…,fd=…))).
# Чистый bash-парсинг: без [[ =~ ]] с кавычками.
ss_extract_listener_process_names() {
  local text="$1"
  local remaining="$text"
  local marker='users:(("'
  local name
  local -a names=()

  while [[ "$remaining" == *"$marker"* ]]; do
    remaining="${remaining#*"$marker"}"
    name="${remaining%%\"*}"
    if [[ -n "$name" ]]; then
      names+=("$name")
    fi
    if [[ "$remaining" == *\"* ]]; then
      remaining="${remaining#*\"}"
    else
      break
    fi
  done

  if ((${#names[@]} == 0)); then
    return 0
  fi
  printf '%s\n' "${names[@]}" | sort -u
}

# Интерактивная авторизация sudo для --install (не зависит от старого timestamp).
ensure_sudo_authenticated() {
  if ! command -v sudo >/dev/null 2>&1; then
    ops_die "sudo is required for --install"
  fi

  ops_info "Refreshing sudo credentials (password may be required)..."
  if ! sudo -v; then
    ops_die "sudo authentication failed; refusing to continue"
  fi
  if ! sudo -n true >/dev/null 2>&1; then
    ops_die "sudo non-interactive check failed after sudo -v"
  fi
}

# Fail-closed проверка 80/443 через привилегированный ss после ensure_sudo_authenticated.
# Порт свободен или каждый listener — caddy. Иначе отказ до записи Caddyfile.
assert_http_ports_safe() {
  local out line names name

  if ! command -v ss >/dev/null 2>&1; then
    ops_die "ss command is required to inspect ports 80/443"
  fi
  if ! sudo -n true >/dev/null 2>&1; then
    ops_die "sudo is not authenticated; cannot inspect privileged port listeners"
  fi

  if ! out="$(sudo -n ss -H -ltnp '( sport = :80 or sport = :443 )' 2>/dev/null)"; then
    ops_die "privileged ss failed while inspecting ports 80/443; refusing to change anything"
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    if ! grep -qE '(^|[[:space:]])LISTEN([[:space:]]|$)' <<<"$line"; then
      continue
    fi

    names="$(ss_extract_listener_process_names "$line")"
    if [[ -z "$names" ]]; then
      ops_die "port 80/443 listener has no process info after privileged ss (unknown). Refusing to change anything automatically — free the port manually."
    fi

    while IFS= read -r name || [[ -n "$name" ]]; do
      [[ -z "$name" ]] && continue
      if [[ "$name" != "caddy" ]]; then
        ops_die "port 80/443 is used by '${name}' (not caddy). Refusing to change anything automatically — free the port manually."
      fi
    done <<<"$names"
  done <<<"$out"

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
    ops_info "Mode: DRY-RUN (no sudo, backup, lock, file writes, or systemctl)"
  else
    ops_info "Mode: INSTALL (confirmation + sudo -v + lock + backup + reload)"
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

  if ! wait_for_https_health; then
    fail_after_install "HTTPS health failed after reload (TLS wait deadline exceeded)"
  fi

  if ! assert_www_canonical_redirect; then
    fail_after_install "www canonical redirect check failed after HTTPS health"
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
    ops_info "Dry-run complete — no sudo, lock, backup, file writes, or systemctl."
    exit 0
  fi

  ops_acquire_production_ops_lock
  ops_require_interactive_confirmation "INSTALL PRODUCTION REVERSE PROXY" \
    "Type INSTALL PRODUCTION REVERSE PROXY to continue:"

  ensure_sudo_authenticated
  apply_install
}

main "$@"
