#!/usr/bin/env bash
# Isolated restore-test freshness / TTL policy (single runtime source of truth).
# Safe to source from restore-test and IHM. No side effects beyond defining
# readonly integers and failing closed on invalid values.
#
# Installed copy (host): /usr/local/lib/online-zapis-tv/lib/isolated-restore-test-policy.sh
# Checkout copy:         scripts/ops/lib/isolated-restore-test-policy.sh

# Prevent double-load under set -u / readonly.
if [[ "${IRT_POLICY_LOADED:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

# Dump selection age for a restore-test run (hours).
IRT_DUMP_MAX_AGE_HOURS=36
# Max age of last-success for IHM enforce (hours) — weekly timer + slack (~8 days).
IRT_SUCCESS_MAX_AGE_HOURS=192
# Absolute max age of the dump referenced by last-success (hours).
IRT_VERIFIED_DUMP_MAX_AGE_HOURS=192
# How far verified dump may lag behind environment latest dump (hours) — weekly window.
IRT_DUMP_LAG_MAX_HOURS=168
# Stopped orphan reaper TTL (hours).
IRT_ORPHAN_TTL_HOURS=6

irt_policy_validate() {
  local name value
  for name in \
    IRT_DUMP_MAX_AGE_HOURS \
    IRT_SUCCESS_MAX_AGE_HOURS \
    IRT_VERIFIED_DUMP_MAX_AGE_HOURS \
    IRT_DUMP_LAG_MAX_HOURS \
    IRT_ORPHAN_TTL_HOURS
  do
    value="${!name-}"
    if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
      echo "error: isolated-restore-test policy invalid: ${name}=${value:-empty}" >&2
      return 1
    fi
  done
  if (( IRT_VERIFIED_DUMP_MAX_AGE_HOURS < IRT_DUMP_MAX_AGE_HOURS )); then
    echo "error: isolated-restore-test policy: VERIFIED_DUMP_MAX_AGE < DUMP_MAX_AGE" >&2
    return 1
  fi
  if (( IRT_SUCCESS_MAX_AGE_HOURS < IRT_DUMP_LAG_MAX_HOURS )); then
    echo "error: isolated-restore-test policy: SUCCESS_MAX_AGE < DUMP_LAG_MAX" >&2
    return 1
  fi
  return 0
}

if ! irt_policy_validate; then
  exit 70
fi

readonly IRT_DUMP_MAX_AGE_HOURS
readonly IRT_SUCCESS_MAX_AGE_HOURS
readonly IRT_VERIFIED_DUMP_MAX_AGE_HOURS
readonly IRT_DUMP_LAG_MAX_HOURS
readonly IRT_ORPHAN_TTL_HOURS
readonly IRT_POLICY_LOADED=1
