/**
 * Unit checks for wheel UI → /complete interest mapping.
 */
import assert from "node:assert/strict";

import {
  buildProductionWheelShareMessage,
  makeShortLabel,
  mapSectorLabelsToWheelSectors,
  mapUiPreferencesToCompletePayload,
} from "../src/components/game/wheel-public-ui-adapter";

function main(): void {
  // primary + zone → public interest zone key (never "primary")
  {
    const lips = mapUiPreferencesToCompletePayload({
      intent: "primary",
      zone: "lips",
    });
    assert.equal(lips.ok, true);
    if (lips.ok) {
      assert.deepEqual(lips.payload, { interest: "lips" });
      assert.equal(lips.payload.confirmedZone, undefined);
    }

    const brows = mapUiPreferencesToCompletePayload({
      intent: "primary",
      zone: "brows",
    });
    assert.equal(brows.ok, true);
    if (brows.ok) {
      assert.deepEqual(brows.payload, { interest: "brows" });
    }

    const eyelids = mapUiPreferencesToCompletePayload({
      intent: "primary",
      zone: "eyelids",
    });
    assert.equal(eyelids.ok, true);
    if (eyelids.ok) {
      assert.deepEqual(eyelids.payload, { interest: "eyelids" });
    }

    const missingZone = mapUiPreferencesToCompletePayload({
      intent: "primary",
      zone: null,
    });
    assert.equal(missingZone.ok, false);
  }

  // refresh / cover require zone
  {
    const refresh = mapUiPreferencesToCompletePayload({
      intent: "refresh",
      zone: "brows",
    });
    assert.equal(refresh.ok, true);
    if (refresh.ok) {
      assert.deepEqual(refresh.payload, {
        interest: "refresh",
        confirmedZone: "brows",
      });
    }

    const cover = mapUiPreferencesToCompletePayload({
      intent: "cover",
      zone: "eyelids",
    });
    assert.equal(cover.ok, true);
    if (cover.ok) {
      assert.deepEqual(cover.payload, {
        interest: "cover",
        confirmedZone: "eyelids",
      });
    }

    const noZone = mapUiPreferencesToCompletePayload({
      intent: "cover",
      zone: null,
    });
    assert.equal(noZone.ok, false);
  }

  // undecided — no confirmedZone
  {
    const undecided = mapUiPreferencesToCompletePayload({
      intent: "undecided",
      zone: null,
    });
    assert.equal(undecided.ok, true);
    if (undecided.ok) {
      assert.deepEqual(undecided.payload, { interest: "undecided" });
      assert.equal(undecided.payload.confirmedZone, undefined);
    }

    // Extra zone must never appear in undecided payload.
    const undecidedWithZone = mapUiPreferencesToCompletePayload({
      intent: "undecided",
      zone: "lips",
    });
    assert.equal(undecidedWithZone.ok, true);
    if (undecidedWithZone.ok) {
      assert.deepEqual(undecidedWithZone.payload, { interest: "undecided" });
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          undecidedWithZone.payload,
          "confirmedZone",
        ),
        false,
      );
    }
  }

  // share: undecided must not echo a stale zone label
  {
    const text = buildProductionWheelShareMessage({
      prizeDisplayName: "Массаж ног 30 минут",
      intent: "undecided",
      zone: "lips",
    });
    assert.match(text, /Направление: Пока выбираю|Пока не определилась|не определ/i);
    assert.match(text, /Зона: не требуется/);
    assert.doesNotMatch(text, /Зона: Губы/);
    assert.match(text, /Мой подарок: Массаж ног 30 минут/);
  }

  // never emit donor "primary" as interest
  {
    for (const zone of ["lips", "brows", "eyelids"] as const) {
      const mapped = mapUiPreferencesToCompletePayload({
        intent: "primary",
        zone,
      });
      assert.equal(mapped.ok, true);
      if (mapped.ok) {
        assert.notEqual(mapped.payload.interest, "primary");
      }
    }
  }

  // sector labels → shortLabel sectors
  {
    const sectors = mapSectorLabelsToWheelSectors([
      { sectorIndex: 0, prizeDisplayName: "Массаж ног 30 минут" },
      { sectorIndex: 1, prizeDisplayName: "Биоревитализант" },
    ]);
    assert.equal(sectors[0]?.id, "0");
    assert.equal(sectors[0]?.shortLabel, "Массаж");
    assert.equal(sectors[0]?.fullName, "Массаж ног 30 минут");
    assert.equal(makeShortLabel(""), "Подарок");
  }

  // share text shape
  {
    const text = buildProductionWheelShareMessage({
      prizeDisplayName: "Тестовый подарок",
      intent: "primary",
      zone: "lips",
    });
    assert.match(text, /Колесо фортуны/);
    assert.match(text, /Направление: Первый перманент/);
    assert.match(text, /Зона: Губы/);
    assert.match(text, /Мой подарок: Тестовый подарок/);
    assert.match(text, /Хочу записаться и активировать подарок/);
  }

  console.log("wheel-public-ui-adapter checks: OK");
}

main();
