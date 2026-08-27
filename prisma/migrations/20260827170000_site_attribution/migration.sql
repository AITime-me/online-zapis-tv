CREATE TABLE "site_attributions" (
    "id" UUID NOT NULL,
    "appointment_id" UUID,
    "booking_request_id" UUID,
    "utm_source" VARCHAR(256),
    "utm_medium" VARCHAR(256),
    "utm_campaign" VARCHAR(256),
    "utm_content" VARCHAR(256),
    "utm_term" VARCHAR(256),
    "referrer" VARCHAR(2048),
    "source_marker" VARCHAR(256),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_attributions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_attributions_owner_xor" CHECK (
        ("appointment_id" IS NOT NULL AND "booking_request_id" IS NULL)
        OR
        ("appointment_id" IS NULL AND "booking_request_id" IS NOT NULL)
    ),
    CONSTRAINT "site_attributions_observed_value" CHECK (
        COALESCE("utm_source", '') ~ '[^[:space:]]'
        OR COALESCE("utm_medium", '') ~ '[^[:space:]]'
        OR COALESCE("utm_campaign", '') ~ '[^[:space:]]'
        OR COALESCE("utm_content", '') ~ '[^[:space:]]'
        OR COALESCE("utm_term", '') ~ '[^[:space:]]'
        OR COALESCE("referrer", '') ~ '[^[:space:]]'
        OR COALESCE("source_marker", '') ~ '[^[:space:]]'
    )
);

CREATE UNIQUE INDEX "site_attributions_appointment_id_key"
ON "site_attributions"("appointment_id");

CREATE UNIQUE INDEX "site_attributions_booking_request_id_key"
ON "site_attributions"("booking_request_id");

ALTER TABLE "site_attributions"
ADD CONSTRAINT "site_attributions_appointment_id_fkey"
FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_attributions"
ADD CONSTRAINT "site_attributions_booking_request_id_fkey"
FOREIGN KEY ("booking_request_id") REFERENCES "booking_requests"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION reject_site_attribution_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'site attribution is immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "site_attributions_immutable"
BEFORE UPDATE ON "site_attributions"
FOR EACH ROW
EXECUTE FUNCTION reject_site_attribution_update();
