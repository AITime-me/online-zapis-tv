-- Reusable server-minted marketing links. Only the SHA-256 token hash is stored.
CREATE TABLE "acquisition_links" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "source_key" VARCHAR(32) NOT NULL,
    "utm_source" VARCHAR(256),
    "utm_medium" VARCHAR(256),
    "utm_campaign" VARCHAR(256),
    "utm_content" VARCHAR(256),
    "utm_term" VARCHAR(256),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquisition_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "acquisition_links_hash_shape" CHECK (
        "token_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "acquisition_links_source_key" CHECK (
        "source_key" IN ('VK_ADS', 'VK_CONTENT', 'YANDEX', 'TWO_GIS')
    )
);

CREATE UNIQUE INDEX "acquisition_links_token_hash_key"
ON "acquisition_links"("token_hash");

CREATE INDEX "acquisition_links_is_active_expires_at_idx"
ON "acquisition_links"("is_active", "expires_at");

-- One-time click evidence. Claimed only inside the conversion transaction.
CREATE TABLE "acquisition_evidence" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "source_key" VARCHAR(32) NOT NULL,
    "acquisition_link_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "appointment_id" UUID,
    "booking_request_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquisition_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "acquisition_evidence_hash_shape" CHECK (
        "token_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "acquisition_evidence_source_key" CHECK (
        "source_key" IN ('VK_ADS', 'VK_CONTENT', 'YANDEX', 'TWO_GIS')
    ),
    CONSTRAINT "acquisition_evidence_owner_state" CHECK (
        (
            "consumed_at" IS NULL
            AND "appointment_id" IS NULL
            AND "booking_request_id" IS NULL
        )
        OR
        (
            "consumed_at" IS NOT NULL
            AND (
                ("appointment_id" IS NOT NULL AND "booking_request_id" IS NULL)
                OR
                ("appointment_id" IS NULL AND "booking_request_id" IS NOT NULL)
            )
        )
    )
);

CREATE UNIQUE INDEX "acquisition_evidence_token_hash_key"
ON "acquisition_evidence"("token_hash");

CREATE UNIQUE INDEX "acquisition_evidence_appointment_id_key"
ON "acquisition_evidence"("appointment_id");

CREATE UNIQUE INDEX "acquisition_evidence_booking_request_id_key"
ON "acquisition_evidence"("booking_request_id");

CREATE INDEX "acquisition_evidence_consumed_at_expires_at_idx"
ON "acquisition_evidence"("consumed_at", "expires_at");

ALTER TABLE "acquisition_evidence"
ADD CONSTRAINT "acquisition_evidence_acquisition_link_id_fkey"
FOREIGN KEY ("acquisition_link_id") REFERENCES "acquisition_links"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "acquisition_evidence"
ADD CONSTRAINT "acquisition_evidence_appointment_id_fkey"
FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acquisition_evidence"
ADD CONSTRAINT "acquisition_evidence_booking_request_id_fkey"
FOREIGN KEY ("booking_request_id") REFERENCES "booking_requests"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Immutable lifecycle: CREATE unconsumed/no-owner; only one transition to
-- consumed with exactly one owner. Identity fields never mutate after insert.
CREATE OR REPLACE FUNCTION acquisition_evidence_immutable_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."consumed_at" IS NOT NULL
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
      RETURN NEW;
    END IF;

    -- Unconsumed row: only permit the one-time consume transition.
    IF NEW."consumed_at" IS NULL THEN
      IF NEW."appointment_id" IS DISTINCT FROM OLD."appointment_id"
         OR NEW."booking_request_id" IS DISTINCT FROM OLD."booking_request_id" THEN
        RAISE EXCEPTION
          'acquisition_evidence cannot set owner without consuming';
      END IF;
      RETURN NEW;
    END IF;

    IF (NEW."appointment_id" IS NOT NULL AND NEW."booking_request_id" IS NOT NULL)
       OR (NEW."appointment_id" IS NULL AND NEW."booking_request_id" IS NULL) THEN
      RAISE EXCEPTION
        'acquisition_evidence consume requires exactly one owner';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER acquisition_evidence_immutable_lifecycle_trg
BEFORE INSERT OR UPDATE ON "acquisition_evidence"
FOR EACH ROW
EXECUTE FUNCTION acquisition_evidence_immutable_lifecycle();
