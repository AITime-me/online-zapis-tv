-- A2.3b2 acquisition-source feed: commit-ordered integer feedOrder + singleton clock.

ALTER TABLE "acquisition_evidence"
ADD COLUMN "feed_order" BIGINT;

CREATE TABLE "acquisition_evidence_feed_order_clock" (
    "id" TEXT NOT NULL,
    "last_order" BIGINT NOT NULL,
    CONSTRAINT "acquisition_evidence_feed_order_clock_pkey" PRIMARY KEY ("id")
);

INSERT INTO "acquisition_evidence_feed_order_clock" ("id", "last_order")
VALUES ('singleton', 0);

-- Deterministic backfill for already-consumed evidence.
WITH "ranked" AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            ORDER BY "consumed_at" ASC, "id" ASC
        ) AS "rn"
    FROM "acquisition_evidence"
    WHERE "consumed_at" IS NOT NULL
)
UPDATE "acquisition_evidence" AS "ae"
SET "feed_order" = "ranked"."rn"
FROM "ranked"
WHERE "ae"."id" = "ranked"."id";

UPDATE "acquisition_evidence_feed_order_clock"
SET "last_order" = COALESCE(
    (
        SELECT MAX("feed_order")
        FROM "acquisition_evidence"
        WHERE "feed_order" IS NOT NULL
    ),
    0
)
WHERE "id" = 'singleton';

CREATE INDEX "acquisition_evidence_feed_order_idx"
ON "acquisition_evidence" ("feed_order", "id")
WHERE "feed_order" IS NOT NULL;

-- feed_order lifecycle: set once on consume or backfill; immutable thereafter.
CREATE OR REPLACE FUNCTION acquisition_evidence_immutable_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."consumed_at" IS NOT NULL
       OR NEW."feed_order" IS NOT NULL
       OR NEW."appointment_id" IS NOT NULL
       OR NEW."booking_request_id" IS NOT NULL THEN
      RAISE EXCEPTION
        'acquisition_evidence must be created unconsumed without owner';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."token_hash" IS DISTINCT FROM OLD."token_hash"
       OR NEW."source_key" IS DISTINCT FROM OLD."source_key"
       OR NEW."acquisition_link_id" IS DISTINCT FROM OLD."acquisition_link_id"
       OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION
        'acquisition_evidence identity fields are immutable after create';
    END IF;

    IF OLD."consumed_at" IS NOT NULL THEN
      IF NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at"
         OR NEW."appointment_id" IS DISTINCT FROM OLD."appointment_id"
         OR NEW."booking_request_id" IS DISTINCT FROM OLD."booking_request_id" THEN
        RAISE EXCEPTION
          'acquisition_evidence consumed row is immutable';
      END IF;
      IF OLD."feed_order" IS NOT NULL
         AND NEW."feed_order" IS DISTINCT FROM OLD."feed_order" THEN
        RAISE EXCEPTION
          'acquisition_evidence feed_order is immutable after set';
      END IF;
      RETURN NEW;
    END IF;

    -- Unconsumed row: only permit the one-time consume transition.
    IF NEW."consumed_at" IS NULL THEN
      IF NEW."appointment_id" IS DISTINCT FROM OLD."appointment_id"
         OR NEW."booking_request_id" IS DISTINCT FROM OLD."booking_request_id"
         OR NEW."feed_order" IS DISTINCT FROM OLD."feed_order" THEN
        RAISE EXCEPTION
          'acquisition_evidence cannot set owner or feed order without consuming';
      END IF;
      RETURN NEW;
    END IF;

    IF (NEW."appointment_id" IS NOT NULL AND NEW."booking_request_id" IS NOT NULL)
       OR (NEW."appointment_id" IS NULL AND NEW."booking_request_id" IS NULL) THEN
      RAISE EXCEPTION
        'acquisition_evidence consume requires exactly one owner';
    END IF;

    IF NEW."feed_order" IS NULL THEN
      RAISE EXCEPTION
        'acquisition_evidence consume requires feed_order';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
