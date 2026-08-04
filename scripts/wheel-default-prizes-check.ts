import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  sumDefaultWheelSectors,
  WHEEL_DEFAULT_SECTOR_COUNT,
  WHEEL_DEFAULT_SLUG,
  WHEEL_PRIZE_SYSTEM_KEYS,
} from "../src/lib/game/wheel/default-prizes";
import { makeShortLabel } from "../src/components/game/wheel-public-ui-adapter";

const ROOT = process.cwd();
const PERMANENT_WHEEL_SLUG = "permanent-wheel";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertNoFootMassageInCanonicalConfig(): void {
  const names = DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((prize) => prize.name);
  assert.ok(
    !names.some((name) => name.toLowerCase().includes("массаж ног")),
    "canonical default prizes must not include foot massage",
  );

  const keys = DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((prize) => prize.systemKey);
  assert.ok(!keys.includes("foot_massage_gift" as never));
}

function assertDiscount15Present(): void {
  const discount15 = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.discount15,
  );
  assert.ok(discount15, "discount 15 prize must exist");
  assert.equal(discount15.name, "Скидка 15% на перманентный макияж");
  assert.equal(discount15.shortDescription, "Скидка 15%");
  assert.equal(discount15.sectorCount, 1);
  assert.equal(discount15.isActive, true);
  assert.equal(discount15.prizeType, "PERCENT_DISCOUNT");
  assert.equal(discount15.prizeRules.discountPercent, 15);
  assert.match(
    discount15.activationConditionText,
    /Подтвердите запись в течение 7 дней/,
  );
  assert.match(discount15.activationConditionText, /в течение 30 дней/);
}

function assertSectorSumIs16(): void {
  assert.equal(WHEEL_DEFAULT_SECTOR_COUNT, 16);
  assert.equal(sumDefaultWheelSectors(), 16);
}

function assertPermanentWheelMigrationScope(): void {
  const migration = read(
    "prisma/migrations/20260804130000_permanent_wheel_discount_15_prize/migration.sql",
  );
  assert.match(migration, /slug = 'permanent-wheel'/);
  assert.match(migration, /foot_massage_gift/);
  assert.match(migration, /permanent_discount_15/);
  assert.doesNotMatch(migration, /slug = 'procedure-gift'/);
}

function assertShortLabelForDiscount15(): void {
  assert.equal(
    makeShortLabel("Скидка 15% на перманентный макияж"),
    "Скидка 15%",
  );
}

assertNoFootMassageInCanonicalConfig();
assertDiscount15Present();
assertSectorSumIs16();
assertPermanentWheelMigrationScope();
assertShortLabelForDiscount15();

assert.equal(WHEEL_DEFAULT_SLUG, PERMANENT_WHEEL_SLUG);

console.log("wheel-default-prizes-check: OK");
