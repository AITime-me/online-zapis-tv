#!/usr/bin/env bash
# Install isolated restore-test scripts + systemd units (host-wide).
# Default mode is dry-run. Does not enable IHM enforce marker unless requested.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/isolated-restore-test-common.sh
source "${SCRIPT_DIR}/lib/isolated-restore-test-common.sh"

INSTALL_HELP=0
INSTALL_APPLY=0
INSTALL_ENABLE_TIMERS=0
INSTALL_ENFORCE=0
INSTALL_UNINSTALL=0

readonly IRT_INSTALL_LIB_DIR="/usr/local/lib/online-zapis-tv"
readonly IRT_SYSTEMD_DIR="/etc/systemd/system"
readonly IRT_UNIT_NAMES=(
  online-zapis-tv-production-restore-test.service
  online-zapis-tv-production-restore-test.timer
  online-zapis-tv-staging-restore-test.service
  online-zapis-tv-staging-restore-test.timer
)

usage() {
  cat <<'EOF'
Usage: scripts/ops/install-isolated-restore-test.sh [options]

Install or plan installation of isolated restore-test (scripts + systemd units).

Options:
  --dry-run           Print plan only (default when --install omitted)
  --install           Copy scripts/units, daemon-reload, create evidence dirs
  --enable-timers     With --install: enable --now both restore-test timers
  --enable-enforce    Create IHM enforce marker (only after a controlled success)
  --uninstall-units   Disable/remove systemd units only (keeps evidence and dumps)
  --help              Show help

Safe first-server procedure:
  1. --install (timers not enabled)
  2. manual controlled run for production then staging
  3. verify evidence + cleanup
  4. --install --enable-timers
  5. --enable-enforce (IHM begins failing on missing/stale success)

Never deletes dumps or evidence on uninstall.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        ;;
      --install)
        INSTALL_APPLY=1
        ;;
      --enable-timers)
        INSTALL_ENABLE_TIMERS=1
        ;;
      --enable-enforce)
        INSTALL_ENFORCE=1
        ;;
      --uninstall-units)
        INSTALL_UNINSTALL=1
        ;;
      --help|-h)
        INSTALL_HELP=1
        ;;
      *)
        irt_die "unknown argument: $1"
        ;;
    esac
    shift
  done
  if [[ "$INSTALL_HELP" -eq 1 ]]; then
    usage
    exit 0
  fi
}

repo_root() {
  local root
  root="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  printf '%s' "$root"
}

print_plan() {
  local root
  root="$(repo_root)"
  irt_info "=== Isolated restore-test install plan ==="
  irt_info "  repository: ${root}"
  irt_info "  install scripts to: ${IRT_INSTALL_LIB_DIR}/"
  irt_info "  evidence root: ${IRT_EVIDENCE_ROOT_DEFAULT}/"
  irt_info "  units:"
  local u
  for u in "${IRT_UNIT_NAMES[@]}"; do
    irt_info "    - ${u}"
  done
  irt_info "  production schedule: Sun 05:00 Asia/Yekaterinburg (+rand 30m)"
  irt_info "  staging schedule: Sun 06:30 Asia/Yekaterinburg (+rand 30m)"
  if [[ "$INSTALL_APPLY" -eq 0 && "$INSTALL_UNINSTALL" -eq 0 && "$INSTALL_ENFORCE" -eq 0 ]]; then
    irt_info "Mode: DRY-RUN"
  fi
  if [[ "$INSTALL_APPLY" -eq 1 ]]; then
    irt_info "Mode: INSTALL (copy + daemon-reload$([[ "$INSTALL_ENABLE_TIMERS" -eq 1 ]] && echo ' + enable timers'))"
  fi
  if [[ "$INSTALL_ENFORCE" -eq 1 ]]; then
    irt_info "Mode: ENABLE-ENFORCE marker for IHM"
  fi
  if [[ "$INSTALL_UNINSTALL" -eq 1 ]]; then
    irt_info "Mode: UNINSTALL-UNITS (evidence retained)"
  fi
}

apply_install() {
  local root
  root="$(repo_root)"
  sudo mkdir -p "${IRT_INSTALL_LIB_DIR}/lib"
  sudo cp -- "${root}/scripts/ops/isolated-restore-test.sh" \
    "${IRT_INSTALL_LIB_DIR}/isolated-restore-test.sh"
  sudo cp -- "${root}/scripts/ops/lib/isolated-restore-test-common.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-common.sh"
  sudo cp -- "${root}/scripts/ops/lib/isolated-restore-test-offline-runner.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-offline-runner.sh"
  sudo cp -- "${root}/scripts/ops/lib/isolated-restore-test-policy.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-policy.sh"
  sudo chown root:deploy \
    "${IRT_INSTALL_LIB_DIR}/isolated-restore-test.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-common.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-offline-runner.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-policy.sh"
  sudo chmod 0750 \
    "${IRT_INSTALL_LIB_DIR}/isolated-restore-test.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-common.sh" \
    "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-offline-runner.sh"
  # Policy is sourced by IHM + restore-test; keep non-executable, owner-readable.
  sudo chmod 0640 "${IRT_INSTALL_LIB_DIR}/lib/isolated-restore-test-policy.sh"

  sudo cp -- "${root}/deploy/systemd/host/online-zapis-tv-production-restore-test.service" \
    "${IRT_SYSTEMD_DIR}/online-zapis-tv-production-restore-test.service"
  sudo cp -- "${root}/deploy/systemd/host/online-zapis-tv-production-restore-test.timer" \
    "${IRT_SYSTEMD_DIR}/online-zapis-tv-production-restore-test.timer"
  sudo cp -- "${root}/deploy/systemd/host/online-zapis-tv-staging-restore-test.service" \
    "${IRT_SYSTEMD_DIR}/online-zapis-tv-staging-restore-test.service"
  sudo cp -- "${root}/deploy/systemd/host/online-zapis-tv-staging-restore-test.timer" \
    "${IRT_SYSTEMD_DIR}/online-zapis-tv-staging-restore-test.timer"

  sudo mkdir -p \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/production/history" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/production/runtime" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/staging/history" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/staging/runtime"
  sudo chown -R deploy:deploy "${IRT_EVIDENCE_ROOT_DEFAULT}"
  sudo chmod 0750 "${IRT_EVIDENCE_ROOT_DEFAULT}" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/production" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/staging" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/production/history" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/staging/history"
  sudo chmod 0700 \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/production/runtime" \
    "${IRT_EVIDENCE_ROOT_DEFAULT}/staging/runtime"

  sudo systemctl daemon-reload

  if [[ "$INSTALL_ENABLE_TIMERS" -eq 1 ]]; then
    sudo systemctl enable --now online-zapis-tv-production-restore-test.timer
    sudo systemctl enable --now online-zapis-tv-staging-restore-test.timer
  else
    irt_info "Timers installed but not enabled. Enable after controlled manual runs."
  fi
}

apply_enforce() {
  sudo mkdir -p "$IRT_EVIDENCE_ROOT_DEFAULT"
  sudo touch "${IRT_EVIDENCE_ROOT_DEFAULT}/${IRT_ENFORCE_MARKER}"
  sudo chown deploy:deploy "${IRT_EVIDENCE_ROOT_DEFAULT}/${IRT_ENFORCE_MARKER}"
  sudo chmod 0640 "${IRT_EVIDENCE_ROOT_DEFAULT}/${IRT_ENFORCE_MARKER}"
  irt_info "IHM enforce marker created: ${IRT_EVIDENCE_ROOT_DEFAULT}/${IRT_ENFORCE_MARKER}"
}

apply_uninstall_units() {
  local u
  for u in \
    online-zapis-tv-production-restore-test.timer \
    online-zapis-tv-staging-restore-test.timer
  do
    sudo systemctl disable --now "$u" 2>/dev/null || true
  done
  for u in "${IRT_UNIT_NAMES[@]}"; do
    sudo rm -f -- "${IRT_SYSTEMD_DIR}/${u}"
  done
  sudo systemctl daemon-reload
  irt_info "Units removed. Evidence and dumps retained under ${IRT_EVIDENCE_ROOT_DEFAULT}"
}

main() {
  parse_args "$@"
  print_plan

  if [[ "$INSTALL_APPLY" -eq 0 && "$INSTALL_UNINSTALL" -eq 0 && "$INSTALL_ENFORCE" -eq 0 ]]; then
    irt_info "Dry-run complete — no changes were made."
    exit 0
  fi

  if [[ "$INSTALL_UNINSTALL" -eq 1 ]]; then
    apply_uninstall_units
  fi
  if [[ "$INSTALL_APPLY" -eq 1 ]]; then
    apply_install
  fi
  if [[ "$INSTALL_ENFORCE" -eq 1 ]]; then
    apply_enforce
  fi
  irt_info "Done."
}

main "$@"
