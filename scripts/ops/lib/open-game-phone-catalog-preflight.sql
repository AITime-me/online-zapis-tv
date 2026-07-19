-- READ-ONLY preflight for open-game phone+catalog uniqueness.
-- Runs on the CURRENT schema BEFORE migrate deploy (new columns may be absent).
-- Computes future keys with the SAME expressions as migration backfill.
-- Outputs ONLY four integer counters (no phones, names, IDs, comments).
-- Does not UPDATE/DELETE/INSERT.

WITH open_game AS (
  SELECT
    CASE
      WHEN length(regexp_replace(coalesce(br."client_phone", ''), '\D', '', 'g')) = 11
        AND left(regexp_replace(coalesce(br."client_phone", ''), '\D', '', 'g'), 1) IN ('7', '8')
        THEN '7' || substr(regexp_replace(coalesce(br."client_phone", ''), '\D', '', 'g'), 2)
      WHEN length(regexp_replace(coalesce(br."client_phone", ''), '\D', '', 'g')) >= 10
        THEN regexp_replace(coalesce(br."client_phone", ''), '\D', '', 'g')
      ELSE NULL
    END AS future_phone,
    gp."game_catalog_id" AS future_catalog
  FROM "booking_requests" br
  INNER JOIN "game_plays" gp ON gp."lead_id" = br."id"
  WHERE br."status" IN ('NEW', 'CONTACTED')
),
conflicts AS (
  SELECT future_phone, future_catalog, COUNT(*)::int AS cnt
  FROM open_game
  WHERE future_phone IS NOT NULL
    AND future_catalog IS NOT NULL
  GROUP BY future_phone, future_catalog
  HAVING COUNT(*) > 1
)
SELECT
  (SELECT COUNT(*)::int FROM conflicts) AS conflict_group_count,
  (SELECT COALESCE(SUM(cnt), 0)::int FROM conflicts) AS conflict_row_count,
  (SELECT COUNT(*)::int FROM open_game WHERE future_catalog IS NULL)
    AS open_game_rows_missing_catalog_count,
  (SELECT COUNT(*)::int FROM open_game WHERE future_phone IS NULL)
    AS open_game_rows_invalid_phone_count;
