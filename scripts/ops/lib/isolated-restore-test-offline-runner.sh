#!/usr/bin/env bash
# Offline OCI runner verifier for isolated migration proof.
# Artifact provisioning is deliberately outside restore/proof execution.

readonly IRT_OFFLINE_RUNNER_ROOT_DEFAULT="/var/lib/online-zapis-tv/restore-test/offline-runner"
IRT_OFFLINE_RUNNER_ROOT="${IRT_OFFLINE_RUNNER_ROOT:-$IRT_OFFLINE_RUNNER_ROOT_DEFAULT}"
IRT_OFFLINE_RUNNER_ERROR=""

irt_offline_runner_fail() {
  IRT_OFFLINE_RUNNER_ERROR="$1"
  return 1
}

irt_offline_runner_sha256_file() {
  sha256sum -- "$1" 2>/dev/null | awk '{print $1}'
}

irt_offline_runner_read_manifest() {
  local manifest="$1" key value seen=""
  IRT_OFFLINE_ARCHIVE_SHA256=""
  IRT_OFFLINE_DOCKERFILE_SHA256=""
  IRT_OFFLINE_LOCK_SHA256=""
  IRT_OFFLINE_IMAGE_ID=""
  IRT_OFFLINE_TARGET_REVISION=""
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ -n "$key" && "$key" != \#* ]] || continue
    case "$key" in
      TARGET_REVISION|OCI_ARCHIVE_SHA256|DOCKERFILE_SHA256|PACKAGE_LOCK_SHA256|IMAGE_ID)
        [[ ",$seen," != *",$key,"* ]] || return 1
        seen+="${key},"
        ;;
      *) return 1 ;;
    esac
    case "$key" in
      TARGET_REVISION) IRT_OFFLINE_TARGET_REVISION="$value" ;;
      OCI_ARCHIVE_SHA256) IRT_OFFLINE_ARCHIVE_SHA256="$value" ;;
      DOCKERFILE_SHA256) IRT_OFFLINE_DOCKERFILE_SHA256="$value" ;;
      PACKAGE_LOCK_SHA256) IRT_OFFLINE_LOCK_SHA256="$value" ;;
      IMAGE_ID) IRT_OFFLINE_IMAGE_ID="$value" ;;
    esac
  done <"$manifest"
  [[ "$IRT_OFFLINE_TARGET_REVISION" =~ ^[a-f0-9]{40}$ ]] \
    && [[ "$IRT_OFFLINE_ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]] \
    && [[ "$IRT_OFFLINE_DOCKERFILE_SHA256" =~ ^[a-f0-9]{64}$ ]] \
    && [[ "$IRT_OFFLINE_LOCK_SHA256" =~ ^[a-f0-9]{64}$ ]] \
    && [[ "$IRT_OFFLINE_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
}

irt_offline_runner_verify() {
  local root manifest archive actual expected label image_ref
  IRT_OFFLINE_RUNNER_ERROR=""
  root="$(realpath -e -- "$IRT_OFFLINE_RUNNER_ROOT" 2>/dev/null || true)"
  [[ -n "$root" && -d "$root" && ! -L "$root" ]] || { irt_offline_runner_fail "ARTIFACT_MISSING"; return 1; }
  manifest="${root}/runner-${IRT_TARGET_REV_ARG}.manifest"
  archive="${root}/runner-${IRT_TARGET_REV_ARG}.oci.tar"
  [[ -f "$manifest" && -f "$archive" && ! -L "$manifest" && ! -L "$archive" ]] \
    || { irt_offline_runner_fail "ARTIFACT_MISSING"; return 1; }
  # Artifact and manifest are root-owned, group-readable by the service actor.
  [[ "$(stat -c '%U:%G:%a' "$manifest" 2>/dev/null || true)" == "root:deploy:640" ]] \
    || { irt_offline_runner_fail "MANIFEST_OWNERSHIP_INVALID"; return 1; }
  [[ "$(stat -c '%U:%G:%a' "$archive" 2>/dev/null || true)" == "root:deploy:640" ]] \
    || { irt_offline_runner_fail "ARCHIVE_OWNERSHIP_INVALID"; return 1; }
  irt_offline_runner_read_manifest "$manifest" || { irt_offline_runner_fail "MANIFEST_INVALID"; return 1; }
  [[ "$IRT_OFFLINE_TARGET_REVISION" == "$IRT_TARGET_REV_ARG" ]] \
    || { irt_offline_runner_fail "TARGET_REVISION_MISMATCH"; return 1; }
  expected="$(irt_offline_runner_sha256_file "$archive" || true)"
  [[ "$expected" == "$IRT_OFFLINE_ARCHIVE_SHA256" ]] || { irt_offline_runner_fail "ARCHIVE_SHA256_MISMATCH"; return 1; }
  expected="$(irt_offline_runner_sha256_file "${IRT_PROOF_SOURCE_DIR}/Dockerfile" || true)"
  [[ "$expected" == "$IRT_OFFLINE_DOCKERFILE_SHA256" ]] || { irt_offline_runner_fail "DOCKERFILE_SHA256_MISMATCH"; return 1; }
  expected="$(irt_offline_runner_sha256_file "${IRT_PROOF_SOURCE_DIR}/package-lock.json" || true)"
  [[ "$expected" == "$IRT_OFFLINE_LOCK_SHA256" ]] || { irt_offline_runner_fail "PACKAGE_LOCK_SHA256_MISMATCH"; return 1; }
  image_ref="online-zapis-tv-offline-proof-runner:${IRT_TARGET_REV_ARG}"
  # Exported solely for the child `docker image inspect` invocation; these values
  # are non-secret provenance hashes and do not enter the proof container.
  export IRT_TARGET_REV_ARG IRT_OFFLINE_DOCKERFILE_SHA256 IRT_OFFLINE_LOCK_SHA256
  actual="$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null || true)"
  [[ "$actual" == "$IRT_OFFLINE_IMAGE_ID" ]] || { irt_offline_runner_fail "IMAGE_ID_MISMATCH"; return 1; }
  for label in \
    "org.opencontainers.image.revision=${IRT_TARGET_REV_ARG}" \
    "com.online-zapis-tv.dockerfile-sha256=${IRT_OFFLINE_DOCKERFILE_SHA256}" \
    "com.online-zapis-tv.package-lock-sha256=${IRT_OFFLINE_LOCK_SHA256}"
  do
    key="${label%%=*}"
    expected="${label#*=}"
    actual="$(docker image inspect --format "{{ index .Config.Labels \"${key}\" }}" "$image_ref" 2>/dev/null || true)"
    [[ "$actual" == "$expected" ]] || { irt_offline_runner_fail "OCI_LABEL_MISMATCH"; return 1; }
  done
  IRT_PROOF_IMAGE="$IRT_OFFLINE_IMAGE_ID"
  return 0
}
