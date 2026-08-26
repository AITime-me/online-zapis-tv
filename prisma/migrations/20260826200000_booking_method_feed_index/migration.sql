-- A2.2 booking-method feed keyset support.
CREATE INDEX "appointments_creator_kind_created_at_id_idx"
ON "appointments" ("creator_kind", "created_at", "id");
