-- Read-only timing semantics audit for pre-compat rollback.
-- Output: two integers on one line, tab-separated:
--   CANONICAL_V2_WRITE_COUNT
--   PHASE1_VERSION_ONLY_V2_COUNT
-- No PII.

SELECT
  COUNT(*) FILTER (
    WHERE "timing_semantics_version" = 2
      AND "timing_canonical_stored_at" IS NOT NULL
  )::bigint AS canonical_v2_write_count,
  COUNT(*) FILTER (
    WHERE "timing_semantics_version" = 2
      AND "timing_canonical_stored_at" IS NULL
  )::bigint AS phase1_version_only_v2_count
FROM "appointments";
