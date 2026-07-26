#!/usr/bin/env bash
# Controllable fake `docker` for isolated-restore-test harness.
# Never talks to a real Docker daemon. Behavior selected via FAKE_DOCKER_MODE
# and state dir FAKE_DOCKER_STATE.
set -euo pipefail

STATE="${FAKE_DOCKER_STATE:?FAKE_DOCKER_STATE required}"
MODE="${FAKE_DOCKER_MODE:-ok}"
LOG="${STATE}/docker.log"
mkdir -p "$STATE/containers"
touch "$LOG"

log_cmd() {
  printf '%s\n' "$*" >>"$LOG"
}

has_pair() {
  local flag="$1"
  local val="$2"
  shift 2
  local prev=""
  local a
  for a in "$@"; do
    if [[ "$prev" == "$flag" && "$a" == "$val" ]]; then
      return 0
    fi
    prev="$a"
  done
  return 1
}

arg_value() {
  local flag="$1"
  shift
  local prev=""
  local a
  for a in "$@"; do
    if [[ "$prev" == "$flag" ]]; then
      printf '%s' "$a"
      return 0
    fi
    prev="$a"
  done
  return 1
}

find_cdir() {
  local ref="$1"
  local d name
  if [[ -d "${STATE}/containers/${ref}" ]]; then
    printf '%s' "${STATE}/containers/${ref}"
    return 0
  fi
  for d in "${STATE}/containers"/*; do
    [[ -d "$d" ]] || continue
    name="$(cat "${d}/name" 2>/dev/null || true)"
    if [[ "$name" == "$ref" || "$name" == "/$ref" ]]; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}

cmd="${1-}"
shift || true
log_cmd "$cmd" "$@"

case "$cmd" in
  info)
    if [[ "$MODE" == "nodocker" ]]; then
      exit 1
    fi
    exit 0
    ;;
  image)
    if [[ "$MODE" == "noimage" ]]; then
      exit 1
    fi
    exit 0
    ;;
  run)
    if [[ "$MODE" == "runfail" ]]; then
      exit 1
    fi
    joined="$*"
    if [[ "$joined" == *"--publish"* || "$joined" == *" -p "* ]]; then
      echo "unsafe publish" >&2
      exit 99
    fi
    if [[ "$joined" != *"--network none"* && "$joined" != *"--network=none"* ]]; then
      echo "missing network none" >&2
      exit 98
    fi
    if [[ "$joined" != *"--pull=never"* ]]; then
      echo "missing pull=never" >&2
      exit 97
    fi
    if [[ "$joined" != *":ro"* ]]; then
      echo "dump mount must be read-only" >&2
      exit 96
    fi
    if [[ "$joined" != *"--pids-limit"* ]]; then
      echo "missing pids-limit" >&2
      exit 95
    fi

    name="$(arg_value --name "$@" || true)"
    cidfile="$(arg_value --cidfile "$@" || true)"
    cid="abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567"

    mkdir -p "${STATE}/containers/${cid}"
    printf '%s\n' "$name" >"${STATE}/containers/${cid}/name"
    printf 'running\n' >"${STATE}/containers/${cid}/status"
    date -u -d '8 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null >"${STATE}/containers/${cid}/created" \
      || date -u +%Y-%m-%dT%H:%M:%SZ >"${STATE}/containers/${cid}/created"
    : >"${STATE}/containers/${cid}/labels"
    prev=""
    for a in "$@"; do
      if [[ "$prev" == "--label" ]]; then
        printf '%s\n' "$a" >>"${STATE}/containers/${cid}/labels"
      fi
      prev="$a"
    done
    if [[ -n "$cidfile" ]]; then
      printf '%s' "$cid" >"$cidfile"
    fi
    printf '%s\n' "$cid"
    exit 0
    ;;
  exec)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -e)
          shift 2 || true
          ;;
        *)
          break
          ;;
      esac
    done
    ref="${1-}"
    shift || true
    tool="${1-}"
    shift || true

    if [[ "$MODE" == "hang-after-run" && "$tool" == "pg_isready" ]]; then
      while true; do sleep 60; done
    fi
    if [[ "$tool" == "pg_isready" ]]; then
      if [[ "$MODE" == "notready" ]]; then
        exit 1
      fi
      exit 0
    fi
    if [[ "$tool" == "psql" ]]; then
      sql="$*"
      if [[ "$MODE" == "integrityfail" ]]; then
        if [[ "$sql" == *"information_schema"* || "$sql" == *"pg_catalog.pg_class"* || "$sql" == *"pg_catalog.pg_namespace"* ]]; then
          exit 1
        fi
      fi
      if [[ "$sql" == *"information_schema.schemata"* ]]; then
        echo 1
        exit 0
      fi
      if [[ "$sql" == *"information_schema.tables"* ]]; then
        if [[ "$MODE" == "notable" ]]; then
          echo 0
        else
          echo 12
        fi
        exit 0
      fi
      exit 0
    fi
    if [[ "$tool" == "pg_restore" ]]; then
      if [[ "$MODE" == "hang-on-restore" ]]; then
        while true; do sleep 60; done
      fi
      if [[ "$MODE" == "restore-child-137" ]]; then
        exit 137
      fi
      if [[ "$MODE" == "restore-child-143" ]]; then
        exit 143
      fi
      if [[ "$MODE" == "restorefail" ]]; then
        exit 1
      fi
      exit 0
    fi
    exit 0
    ;;
  inspect)
    fmt=""
    ref=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format|-f)
          fmt="$2"
          shift 2
          ;;
        *)
          ref="$1"
          shift
          ;;
      esac
    done

    case "$ref" in
      tvoe-vremya-production-postgres|tvoe-vremya-staging-postgres|tvoe-vremya-production-app|tvoe-vremya-staging-app)
        if [[ "$MODE" == "forbidden-mutate" && -f "${STATE}/forbidden-mutated" ]]; then
          if [[ "$fmt" == *RestartCount* ]]; then
            echo 99
            exit 0
          fi
        fi
        if [[ "$fmt" == *'.Id'* ]]; then
          echo "ffffffffeeee"
          exit 0
        fi
        if [[ "$fmt" == *Running* ]]; then
          echo "true"
          exit 0
        fi
        if [[ "$fmt" == *RestartCount* ]]; then
          echo 0
          exit 0
        fi
        if [[ "$fmt" == *StartedAt* ]]; then
          echo "2026-01-01T00:00:00Z"
          exit 0
        fi
        exit 0
        ;;
    esac

    cdir="$(find_cdir "$ref" || true)"
    [[ -n "$cdir" ]] || exit 1

    if [[ -z "$fmt" ]]; then
      exit 0
    fi
    if [[ "$fmt" == *'.Name'* ]]; then
      echo "/$(cat "${cdir}/name")"
      exit 0
    fi
    if [[ "$fmt" == *State.Status* ]]; then
      cat "${cdir}/status"
      exit 0
    fi
    if [[ "$fmt" == *Created* ]]; then
      cat "${cdir}/created"
      exit 0
    fi
    if [[ "$fmt" == *Labels* ]]; then
      key="$(printf '%s' "$fmt" | sed -n 's/.*Labels "\([^"]*\)".*/\1/p')"
      # labels stored as key=value
      grep -E "^${key}=" "${cdir}/labels" 2>/dev/null | head -n1 | cut -d= -f2- || true
      exit 0
    fi
    exit 0
    ;;
  rm)
    ref=""
    for a in "$@"; do
      case "$a" in
        -f|--force) ;;
        *) ref="$a" ;;
      esac
    done
    if [[ "$MODE" == "rmfail" ]]; then
      exit 1
    fi
    cdir="$(find_cdir "$ref" || true)"
    if [[ -n "$cdir" ]]; then
      rm -rf -- "$cdir"
    fi
    exit 0
    ;;
  ps)
    for d in "${STATE}/containers"/*; do
      [[ -d "$d" ]] || continue
      basename "$d"
    done
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
