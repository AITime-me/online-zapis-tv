-- Replace legacy foot-massage wheel prize with 15% permanent-makeup discount
-- for catalog slug permanent-wheel only. Idempotent: skips when already migrated.

DO $$
DECLARE
  discount_terms CONSTANT text := 'Скидка 15% на одну процедуру перманентного макияжа. Подтвердите запись в течение 7 дней после выигрыша, пройти процедуру можно в течение 30 дней. Скидка действует один раз, не суммируется с другими скидками и специальными предложениями и не обменивается на деньги.';
  prize_rules CONSTANT jsonb := jsonb_build_object(
    'version', 1,
    'prizeType', 'PERCENT_DISCOUNT',
    'systemKey', 'permanent_discount_15',
    'discountPercent', 15,
    'applicableProcedures', jsonb_build_array(
      'permanent_primary',
      'cover',
      'refresh',
      'lips_permanent_primary',
      'lips_cover',
      'lips_refresh'
    ),
    'excludedProcedures', jsonb_build_array(
      'correction',
      'removal',
      'lips_correction'
    ),
    'upgradeSurcharge', null,
    'stackingWithOtherDiscounts', false,
    'stackingWithOtherGifts', false,
    'cashRedemptionForbidden', true,
    'zoneRestriction', null,
    'replacement', null,
    'termsText', discount_terms,
    'confirmWindowDays', null,
    'procedureWindowDays', null
  );
BEGIN
  -- If discount 15 already exists, deactivate legacy foot-massage rows only.
  UPDATE game_gifts AS gg
  SET
    is_active = false,
    probability = 0,
    updated_at = CURRENT_TIMESTAMP
  WHERE gg.game_catalog_id IN (
    SELECT id FROM game_catalog WHERE slug = 'permanent-wheel'
  )
  AND (
    gg.system_key = 'foot_massage_gift'
    OR gg.name ILIKE '%Массаж ног%'
  )
  AND EXISTS (
    SELECT 1
    FROM game_gifts existing
    WHERE existing.game_catalog_id = gg.game_catalog_id
      AND existing.system_key = 'permanent_discount_15'
      AND existing.id <> gg.id
  );

  -- Otherwise transform the legacy foot-massage row in place.
  UPDATE game_gifts AS gg
  SET
    name = 'Скидка 15% на перманентный макияж',
    short_description = 'Скидка 15%',
    is_active = true,
    probability = 1,
    prize_type = 'PERCENT_DISCOUNT',
    system_key = 'permanent_discount_15',
    activation_condition_text = discount_terms,
    prize_rules = prize_rules,
    sort_order = 70,
    priority = 'standard',
    updated_at = CURRENT_TIMESTAMP
  WHERE gg.game_catalog_id IN (
    SELECT id FROM game_catalog WHERE slug = 'permanent-wheel'
  )
  AND (
    gg.system_key = 'foot_massage_gift'
    OR gg.name ILIKE '%Массаж ног%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM game_gifts existing
    WHERE existing.game_catalog_id = gg.game_catalog_id
      AND existing.system_key = 'permanent_discount_15'
      AND existing.id <> gg.id
  );
END $$;
