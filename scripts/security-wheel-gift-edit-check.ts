/**
 * Safe Wheel gift business-field editing + historical delete protection.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertFutureWheelSectorConfig,
  assertWheelGiftIdentityImmutable,
  assertWheelGiftUpdateAllowlist,
  isWheelIdentityGift,
  serverAssignmentReferencesGiftId,
  WHEEL_GIFT_MUTABLE_BUSINESS_FIELDS,
} from "../src/lib/game/admin-gift-update-policy";
import type { WheelSectorGift } from "../src/lib/game/wheel/sector-assignment";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function gift(
  id: string,
  probability: number,
  isActive = true,
): WheelSectorGift {
  return {
    id,
    systemKey: id,
    name: id,
    isActive,
    probability,
    sortOrder: 0,
  };
}

function assertWheelPanelEditableBusinessFields(): void {
  const panel = read("src/components/admin/wheel-fortune-panel.tsx");

  assert.match(panel, /nameDraft/);
  assert.match(panel, /descriptionDraft/);
  assert.match(panel, /conditionDraft/);
  assert.match(panel, /Название подарка/);
  assert.match(panel, /Короткое описание/);
  assert.match(panel, /Условие получения/);
  assert.match(panel, /Количество секторов \/ вес/);
  assert.match(panel, /Приз активен/);

  const saveGift = panel.match(/const saveGift = async \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(saveGift, "saveGift must exist");
  const bodyMatch = saveGift[1]!.match(/JSON\.stringify\(\{([\s\S]*?)\}\)/);
  assert.ok(bodyMatch, "saveGift must JSON.stringify a body");
  assert.match(
    bodyMatch[1]!,
    /name,[\s\S]*shortDescription,[\s\S]*isActive:[\s\S]*probability:[\s\S]*activationConditionText/,
  );
  assert.doesNotMatch(
    bodyMatch[1]!,
    /systemKey|prizeType|prizeRules|sortOrder|gameCatalogId/,
    "wheel gift save body must not send protected identity/mechanic fields",
  );
  assert.match(saveGift[1]!, /Название подарка не может быть пустым/);
  assert.match(saveGift[1]!, /Описание подарка не может быть пустым/);
  assert.match(panel, /Тип, ключ и prizeRules[\s\S]*нельзя менять/);
}

function assertExecutablePolicyGuards(): void {
  assert.deepEqual(WHEEL_GIFT_MUTABLE_BUSINESS_FIELDS, [
    "name",
    "shortDescription",
    "activationConditionText",
    "probability",
    "isActive",
  ]);

  assert.equal(
    isWheelIdentityGift({ systemKey: "discount_10", prizeType: null }),
    true,
  );
  assert.equal(
    isWheelIdentityGift({ systemKey: null, prizeType: "PERCENT_DISCOUNT" }),
    true,
  );
  assert.equal(isWheelIdentityGift({ systemKey: null, prizeType: null }), false);

  const existing = {
    image: null as string | null,
    priority: "standard",
    cardStyle: "default",
    allowedGameDirections: [] as string[],
    allowedResultTypes: [] as string[],
    requiredPremiumLevel: 0,
    activationMode: "SINGLE_PAID_SERVICE",
    minCourseSessions: null as number | null,
    sortOrder: 3,
  };

  assert.doesNotThrow(() =>
    assertWheelGiftUpdateAllowlist({
      existing,
      patch: {
        name: "Новое",
        shortDescription: "Описание",
        activationConditionText: "Условие",
        probability: 2,
        isActive: false,
        activationMode: "SINGLE_PAID_SERVICE",
        minCourseSessions: null,
      },
    }),
  );

  assert.throws(
    () =>
      assertWheelGiftUpdateAllowlist({
        existing,
        patch: { sortOrder: 9 },
      }),
    /sortOrder/,
  );
  assert.throws(
    () =>
      assertWheelGiftUpdateAllowlist({
        existing,
        patch: { activationMode: "COURSE_MIN_SESSIONS" },
      }),
    /Режим получения/,
  );
  assert.throws(
    () =>
      assertWheelGiftUpdateAllowlist({
        existing,
        patch: { priority: "jackpot" },
      }),
    /priority/,
  );

  const baseRules = {
    version: 1 as const,
    prizeType: "PERCENT_DISCOUNT" as const,
    systemKey: "discount_10",
    discountPercent: 10,
    applicableProcedures: ["permanent_primary"] as const,
    excludedProcedures: [] as const,
    upgradeSurcharge: null,
    stackingWithOtherDiscounts: false,
    stackingWithOtherGifts: false,
    cashRedemptionForbidden: true,
    zoneRestriction: null,
    replacement: null,
    termsText: "Скидка 10%",
    confirmWindowDays: null,
    procedureWindowDays: null,
  };

  assert.throws(
    () =>
      assertWheelGiftIdentityImmutable({
        existing: {
          systemKey: "discount_10",
          prizeType: "PERCENT_DISCOUNT",
          prizeRules: baseRules,
        },
        patch: { systemKey: "discount_20" },
      }),
    /systemKey/,
  );
  assert.throws(
    () =>
      assertWheelGiftIdentityImmutable({
        existing: {
          systemKey: "discount_10",
          prizeType: "PERCENT_DISCOUNT",
          prizeRules: baseRules,
        },
        patch: { prizeType: "GIFT_SERVICE" },
      }),
    /Тип приза/,
  );
  assert.throws(
    () =>
      assertWheelGiftIdentityImmutable({
        existing: {
          systemKey: "discount_10",
          prizeType: "PERCENT_DISCOUNT",
          prizeRules: baseRules,
        },
        patch: {
          prizeRules: {
            ...baseRules,
            discountPercent: 20,
            termsText: "Скидка 20%",
          },
        },
      }),
    /prizeRules/,
  );

  assert.equal(
    serverAssignmentReferencesGiftId(
      {
        giftId: "gift-1",
        prizeSnapshot: {
          original: { giftId: "gift-1" },
          replacementFallback: { giftId: "gift-2" },
        },
        claimLock: { finalPrize: { giftId: "gift-2" } },
      },
      "gift-2",
    ),
    true,
  );
  assert.equal(
    serverAssignmentReferencesGiftId(
      {
        giftId: "gift-1",
        prizeSnapshot: {
          original: { giftId: "gift-1" },
          replacementFallback: null,
        },
      },
      "gift-9",
    ),
    false,
  );
}

function assertFutureSectorConfigGuard(): void {
  const valid = [gift("a", 8), gift("b", 8)];
  assert.doesNotThrow(() =>
    assertFutureWheelSectorConfig({
      catalogStatus: "ACTIVE",
      expectedSectorCount: 16,
      currentGifts: valid,
      nextGifts: [gift("a", 7), gift("b", 9)],
    }),
  );
  assert.throws(
    () =>
      assertFutureWheelSectorConfig({
        catalogStatus: "ACTIVE",
        expectedSectorCount: 16,
        currentGifts: valid,
        nextGifts: [gift("a", 7), gift("b", 8)],
      }),
    /секторов/,
  );
  assert.doesNotThrow(() =>
    assertFutureWheelSectorConfig({
      catalogStatus: "DRAFT",
      expectedSectorCount: 16,
      currentGifts: [gift("a", 7), gift("b", 8)],
      nextGifts: [gift("a", 6), gift("b", 8)],
    }),
  );
}

function assertGameAdminGiftGuards(): void {
  const service = read("src/services/GameAdminService.ts");

  assert.match(service, /assertWheelGiftUpdateAllowlist/);
  assert.match(service, /assertWheelGiftIdentityImmutable/);
  assert.match(service, /assertFutureWheelSectorConfig/);
  assert.match(service, /isWheelIdentityGift/);
  assert.match(service, /serverAssignmentReferencesGiftId/);
  assert.match(service, /systemKey нельзя изменить у существующего подарка/);
  assert.match(
    service,
    /Тип приза нельзя изменить\. Создайте новый подарок и отключите текущий/,
  );
  assert.match(
    service,
    /prizeRules нельзя изменить через обычное редактирование/,
  );
  assert.match(service, /parseNonNegativeIntStrict/);
  assert.match(service, /\/\^\\d\+\$\//);
  assert.match(service, /Название подарка не может быть пустым/);
  assert.match(service, /Описание подарка не может быть пустым/);
  assert.match(service, /rejectClientCatalogRebind/);
  assert.match(service, /assertGiftBelongsToCatalog/);

  assert.match(service, /export async function deleteGameGift/);
  assert.match(
    service,
    /export async function deleteGameGift[\s\S]*gamePlay\.count[\s\S]*selectedGiftId:\s*id/,
  );
  assert.match(
    service,
    /path:\s*\[["']originalPrize["'],\s*["']giftId["']\]/,
  );
  assert.match(
    service,
    /path:\s*\[["']finalPrize["'],\s*["']giftId["']\]/,
  );
  assert.match(
    service,
    /export async function deleteGameGift[\s\S]*status:\s*["']ACTIVE["']/,
  );
  assert.match(
    service,
    /export async function deleteGameGift[\s\S]*serverAssignmentReferencesGiftId/,
  );
  assert.match(
    service,
    /export async function deleteGameGift[\s\S]*Отключите его вместо удаления/,
  );
}

function assertSnapshotContractUntouched(): void {
  const resolveSource = read("src/lib/game/game-booking-consume-rules.ts");
  assert.match(resolveSource, /parseGiftSnapshot\(play\.giftSnapshot\)/);
  assert.match(resolveSource, /giftName:\s*snapshot\.name\.trim\(\)/);

  const panel = read("src/components/admin/wheel-fortune-panel.tsx");
  assert.doesNotMatch(panel, /giftSnapshot/);
  assert.doesNotMatch(panel, /prisma\.gamePlay/);

  const publicComplete = read(
    "src/lib/game/wheel/wheel-public-complete-snapshot.ts",
  );
  assert.match(publicComplete, /assignment\.prizeSnapshot/);
  assert.match(
    read("src/lib/game/wheel/wheel-assignment-contract.ts"),
    /prizeSnapshot freezes prize metadata at start/,
  );
}

function assertRouteStillGuarded(): void {
  const route = read("src/app/api/admin/games/[id]/gifts/[giftId]/route.ts");
  assert.match(route, /requireProtectedMutatingApi/);
  assert.match(route, /GAME_ADMIN_ROLES/);
  assert.match(route, /updateGameGift/);
  assert.match(route, /deleteGameGift/);
}

function main(): void {
  assertWheelPanelEditableBusinessFields();
  assertExecutablePolicyGuards();
  assertFutureSectorConfigGuard();
  assertGameAdminGiftGuards();
  assertSnapshotContractUntouched();
  assertRouteStillGuarded();
  console.log("security-wheel-gift-edit-check: OK");
}

main();
