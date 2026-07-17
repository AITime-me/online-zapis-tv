#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/production-ops-common.sh
source "${SCRIPT_DIR}/lib/production-ops-common.sh"

INSTALL_HELP=0
INSTALL_APPLY=0

readonly PRODUCTION_SYSTEMD_SERVICE="online-zapis-tv-production-backup.service"
readonly PRODUCTION_SYSTEMD_TIMER="online-zapis-tv-production-backup.timer"
readonly PRODUCTION_SYSTEMD_SOURCE_DIR="deploy/systemd/production"

usage() {
  cat <<'EOF'
Usage: scripts/ops/install-production-backup-timer.sh [--dry-run] [--install] [--help]

Show or apply installation steps for the production backup systemd timer.
Does not run backup, docker, or systemctl unless --install is used on the server.

Options:
  --dry-run   Print install plan only (default when --install is omitted)
  --install   Copy unit files to /etc/systemd/system and run daemon-reload/enable/start
  --help      Show this help

Run from /opt/online-zapis-tv-production as a user with sudo for --install.
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
        if [[ "$INSTALL_APPLY" -eq 1 ]]; then
          ops_die "duplicate --install"
        fi
        INSTALL_APPLY=1
        ;;
      --help|-h)
        if [[ "$INSTALL_HELP" -eq 1 ]]; then
          ops_die "duplicate --help"
        fi
        INSTALL_HELP=1
        ;;
      *)
        ops_die "unknown argument: $1"
        ;;
    esac
    shift
  done

  if [[ "$INSTALL_HELP" -eq 1 ]]; then
    if [[ "$OPS_DRY_RUN" -eq 1 || "$INSTALL_APPLY" -eq 1 ]]; then
      ops_die "--help cannot be combined with other options"
    fi
    usage
    exit 0
  fi

  if [[ "$INSTALL_APPLY" -eq 0 ]]; then
    OPS_DRY_RUN=1
  fi
}

print_plan() {
  local service_src timer_src
  service_src="${OPS_REPO_ROOT}/${PRODUCTION_SYSTEMD_SOURCE_DIR}/${PRODUCTION_SYSTEMD_SERVICE}"
  timer_src="${OPS_REPO_ROOT}/${PRODUCTION_SYSTEMD_SOURCE_DIR}/${PRODUCTION_SYSTEMD_TIMER}"

  ops_info "=== Production backup timer install plan ==="
  ops_info "  repository: ${OPS_REPO_ROOT}"
  ops_info "  service unit: ${PRODUCTION_SYSTEMD_SERVICE}"
  ops_info "  timer unit: ${PRODUCTION_SYSTEMD_TIMER}"
  ops_info "  source service: ${service_src}"
  ops_info "  source timer: ${timer_src}"
  ops_info "  backup script: ${OPS_REPO_ROOT}/scripts/ops/production-backup.sh"
  ops_info "  schedule: 02:30 Asia/Yekaterinburg (see timer unit)"
  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Mode: DRY-RUN (no files copied, no systemctl)"
  else
    ops_info "Mode: INSTALL"
  fi
  ops_info "Steps:"
  ops_info "  1. sudo cp ${service_src} /etc/systemd/system/"
  ops_info "  2. sudo cp ${timer_src} /etc/systemd/system/"
  ops_info "  3. sudo systemctl daemon-reload"
  ops_info "  4. sudo systemctl enable ${PRODUCTION_SYSTEMD_TIMER}"
  ops_info "  5. sudo systemctl start ${PRODUCTION_SYSTEMD_TIMER}"
}

apply_install() {
  local service_src timer_src
  service_src="${OPS_REPO_ROOT}/${PRODUCTION_SYSTEMD_SOURCE_DIR}/${PRODUCTION_SYSTEMD_SERVICE}"
  timer_src="${OPS_REPO_ROOT}/${PRODUCTION_SYSTEMD_SOURCE_DIR}/${PRODUCTION_SYSTEMD_TIMER}"

  [[ -f "$service_src" ]] || ops_die "missing unit file: ${service_src}"
  [[ -f "$timer_src" ]] || ops_die "missing unit file: ${timer_src}"

  sudo cp -- "$service_src" "/etc/systemd/system/${PRODUCTION_SYSTEMD_SERVICE}"
  sudo cp -- "$timer_src" "/etc/systemd/system/${PRODUCTION_SYSTEMD_TIMER}"
  sudo systemctl daemon-reload
  sudo systemctl enable "$PRODUCTION_SYSTEMD_TIMER"
  sudo systemctl start "$PRODUCTION_SYSTEMD_TIMER"
}

main() {
  parse_args "$@"
  ops_setup_common_traps
  ops_cd_repo_root "$(pwd)"
  ops_assert_production_checkout

  [[ -d "${OPS_REPO_ROOT}/${PRODUCTION_SYSTEMD_SOURCE_DIR}" ]] \
    || ops_die "missing ${PRODUCTION_SYSTEMD_SOURCE_DIR} in repository"

  print_plan

  if [[ "$OPS_DRY_RUN" -eq 1 ]]; then
    ops_info "Dry-run complete — no systemd changes were made."
    exit 0
  fi

  apply_install
  ops_info "Production backup timer installed. Check: systemctl list-timers ${PRODUCTION_SYSTEMD_TIMER}"
}

main "$@"
