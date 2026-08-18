/**
 * Prize compatibility is locked at /start, before the client sees the spin result.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  serializeDefaultPrizeRules,
  WHEEL_PRIZE_SYSTEM_KEYS,
} from "../src/lib/game/wheel/default-prizes";
import { parsePrizeRules } from "../src/lib/game/wheel/prize-rules-contract";
import { overlayWinningSectorOnWheelSectors } from "../src/components/game/wheel-public-ui-adapter";
import {
  buildWheelAssignmentPrizeSnapshot,
  buildTestWheelServerAssignment,
} from "../src/lib/game/wheel/wheel-assignment-prize-snapshot";
import {
  buildWheelClaimLock,
  overlayWinningSectorLabels,
  parseWheelClaimLock,
  resolveWheelPublicPrizeDisplayName,
  withWheelClaimLock,
} from "../src/lib/game/wheel/wheel-claim-lock";
import { parseWheelServerAssignment } from "../src/lib/game/wheel/parse-wheel-assignment";
import { buildWheelCompleteGiftSnapshot } from "../src/lib/game/wheel/wheel-public-complete-snapshot";
import {
  isWheelReplayCooldownActive,
  WHEEL_REPLAY_COOLDOWN_MS,
} from "../src/lib/game/wheel/wheel-replay-cooldown";
import type { WheelInterestKey } from "../src/lib/game/wheel/procedure-types";
import type { WheelZone } from "../src/lib/game/wheel/zone-types";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function buildCatalogGifts() {
  return DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((definition, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: definition.name,
    shortDescription: definition.shortDescription,
    image: null,
    priority: "standard",
    cardStyle: "default",
    isActive: definition.isActive,
    probability: definition.sectorCount,
    systemKey: definition.systemKey,
    sortOrder: definition.sortOrder,
    prizeType: definition.prizeType,
    prizeRules: serializeDefaultPrizeRules(definition),
    activationMode: "SINGLE_PAID_SERVICE" as const,
    minCourseSessions: null,
    activationConditionText: definition.activationConditionText,
  }));
}

function lipsBioAssignment() {
  const gifts = buildCatalogGifts();
  const lips = gifts.find(
    (gift) => gift.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant,
  )!;
  const snapshot = buildWheelAssignmentPrizeSnapshot(lips.id, gifts);
  assert.ok(snapshot);
  return buildTestWheelServerAssignment({
    sectorIndex: 15,
    giftId: lips.id,
    prizeSystemKey: lips.systemKey!,
    prizeSnapshot: snapshot!,
  });
}

function lockCase(input: {
  interest: WheelInterestKey;
  zone: WheelZone;
  now?: Date;
}) {
  const assignment = lipsBioAssignment();
  return buildWheelClaimLock({
    assignment,
    confirmedInterest: input.interest,
    confirmedZone: input.zone,
    now: input.now ?? new Date("2026-08-18T10:00:00.000Z"),
  });
}

function assertReplacementMatrix(): void {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const lipsName = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant,
  )!.name;
  const handName = DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
    (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.handCare,
  )!.name;

  const cases: Array<{
    interest: WheelInterestKey;
    zone: WheelZone;
    replaced: boolean;
  }> = [
    { interest: "lips_permanent", zone: "lips", replaced: false },
    { interest: "brows_permanent", zone: "brows", replaced: true },
    { interest: "eyelids_permanent", zone: "eyelids", replaced: true },
    { interest: "refresh", zone: "lips", replaced: false },
    { interest: "refresh", zone: "brows", replaced: true },
    { interest: "refresh", zone: "eyelids", replaced: true },
    { interest: "cover", zone: "lips", replaced: false },
    { interest: "cover", zone: "brows", replaced: true },
    { interest: "cover", zone: "eyelids", replaced: true },
    { interest: "undecided", zone: "unknown", replaced: true },
  ];

  for (const item of cases) {
    const lock = lockCase({ ...item, now });
    assert.equal(lock.interest, item.interest, item.interest);
    assert.equal(lock.confirmedZone, item.zone);
    assert.equal(lock.originalPrize.name, lipsName);
    assert.equal(lock.replacementApplied, item.replaced, `${item.interest}/${item.zone}`);
    assert.equal(lock.finalPrize.name, item.replaced ? handName : lipsName);
    if (item.replaced) {
      assert.equal(
        lock.replacementReason,
        item.interest === "undecided"
          ? "undecided_interest"
          : "confirmed_non_lips_zone",
      );
    } else {
      assert.equal(lock.replacementReason, null);
    }
  }
}

function assertPersistedLockAndDisplay(): void {
  const assignment = lipsBioAssignment();
  const lock = buildWheelClaimLock({
    assignment,
    confirmedInterest: "brows_permanent",
    confirmedZone: "brows",
    now: new Date("2026-08-18T10:00:00.000Z"),
  });
  const locked = withWheelClaimLock(assignment, lock);
  assert.equal(locked.sectorIndex, 15);
  assert.equal(locked.prizeSystemKey, WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant);
  assert.equal(locked.giftId, assignment.giftId);

  const parsed = parseWheelServerAssignment(locked);
  assert.ok(parsed?.claimLock);
  assert.equal(parsed!.claimLock!.replacementApplied, true);
  assert.equal(
    resolveWheelPublicPrizeDisplayName(parsed!),
    lock.finalPrize.name,
  );
  assert.deepEqual(parseWheelClaimLock(parsed!.claimLock), lock);

  const labels = overlayWinningSectorLabels(
    [
      { sectorIndex: 14, prizeDisplayName: "Скидка 15% на перманентный макияж" },
      { sectorIndex: 15, prizeDisplayName: lock.originalPrize.name },
    ],
    15,
    lock.finalPrize.name,
  );
  assert.equal(labels[15 - 14]!.prizeDisplayName, lock.finalPrize.name);
  assert.equal(labels[0]!.prizeDisplayName, "Скидка 15% на перманентный макияж");

  const sectors = overlayWinningSectorOnWheelSectors(
    [
      { id: "14", shortLabel: "Скидка", fullName: "Скидка 15% на перманентный макияж" },
      { id: "15", shortLabel: "Биоревит", fullName: lock.originalPrize.name },
    ],
    { sectorIndex: 15, prizeDisplayName: lock.finalPrize.name },
  );
  assert.equal(sectors[1]!.fullName, lock.finalPrize.name);
  assert.notEqual(sectors[1]!.shortLabel, "Биоревит");
}

function assertUndecidedCompleteUsesFinalFallback(): void {
  const assignment = lipsBioAssignment();
  const lock = buildWheelClaimLock({
    assignment,
    confirmedInterest: "undecided",
    confirmedZone: "unknown",
    now: new Date("2026-08-18T10:00:00.000Z"),
  });
  assert.equal(lock.replacementApplied, true);
  assert.equal(lock.replacementReason, "undecided_interest");
  const locked = withWheelClaimLock(assignment, lock);
  assert.equal(locked.sectorIndex, assignment.sectorIndex);
  assert.equal(locked.giftId, assignment.giftId);
  assert.equal(
    resolveWheelPublicPrizeDisplayName(locked),
    lock.finalPrize.name,
  );

  const built = buildWheelCompleteGiftSnapshot({
    assignment: locked,
    confirmedInterest: lock.interest,
    confirmedZone: lock.confirmedZone,
    now: new Date("2026-08-18T10:00:00.000Z"),
  });
  assert.equal(built.ok, true);
  if (!built.ok) {
    throw new Error("expected complete snapshot");
  }
  assert.equal(
    built.giftSnapshot.originalPrize?.systemKey,
    lock.originalPrize.systemKey,
  );
  assert.equal(
    built.giftSnapshot.finalPrize?.systemKey,
    lock.finalPrize.systemKey,
  );
  assert.equal(built.giftSnapshot.replacementReason, "undecided_interest");
  assert.equal(built.selectedGiftId, lock.finalPrize.giftId);
  assert.notEqual(built.selectedGiftId, lock.originalPrize.giftId);
}

function assertCooldownRegression(): void {
  assert.equal(WHEEL_REPLAY_COOLDOWN_MS, 14 * 24 * 60 * 60 * 1000);
  const startedAt = new Date("2026-08-01T10:00:00.000Z");
  assert.equal(
    isWheelReplayCooldownActive(
      startedAt,
      new Date(startedAt.getTime() + WHEEL_REPLAY_COOLDOWN_MS - 1),
    ),
    true,
  );
  assert.equal(
    isWheelReplayCooldownActive(
      startedAt,
      new Date(startedAt.getTime() + WHEEL_REPLAY_COOLDOWN_MS),
    ),
    false,
  );
  assert.equal(
    isWheelReplayCooldownActive(
      startedAt,
      new Date(startedAt.getTime() + WHEEL_REPLAY_COOLDOWN_MS + 1),
    ),
    false,
  );
}

function assertWiring(): void {
  const service = read("src/services/WheelPublicGameService.ts");
  assert.match(service, /buildWheelClaimLock/);
  assert.match(service, /withWheelClaimLock/);
  assert.match(service, /resolveStartInterestAndZone/);
  assert.match(service, /assignment\.claimLock/);
  assert.match(service, /randomInt:\s*input\.randomInt/);
  const startFn = service.match(
    /export async function startWheelPublicGame\([\s\S]*?registerWheelPhoneBoundSession/,
  );
  assert.ok(startFn, "startWheelPublicGame must register a session");
  assert.match(
    startFn[0]!,
    /resolveStartInterestAndZone/,
    "old clients without interest must fail before a session is registered",
  );

  const startRoute = read("src/app/api/game/wheel/start/route.ts");
  assert.match(startRoute, /interest:\s*body\.interest/);
  assert.match(startRoute, /confirmedZone:\s*body\.confirmedZone/);
  assert.doesNotMatch(startRoute, /randomInt/);
  const errorHandlerAt = startRoute.indexOf("handleWheelError");
  const cookieApplyAt = startRoute.indexOf(
    "applyCookieOperations(response, result.cookieOperations)",
  );
  assert.ok(
    cookieApplyAt > 0 && errorHandlerAt >= 0,
    "start cookies are applied only on the success path",
  );

  const controller = read("src/components/game/wheel-fortune-public.tsx");
  assert.match(controller, /overlayWinningSectorOnWheelSectors/);
  assert.match(controller, /interest:\s*mapped\.payload\.interest/);

  const rules = parsePrizeRules(
    serializeDefaultPrizeRules(
      DEFAULT_WHEEL_PRIZE_DEFINITIONS.find(
        (prize) => prize.systemKey === WHEEL_PRIZE_SYSTEM_KEYS.lipsBiorevitalizant,
      )!,
    ),
  );
  assert.equal(rules?.replacement?.fallbackSystemKey, WHEEL_PRIZE_SYSTEM_KEYS.handCare);
}

function main(): void {
  assertReplacementMatrix();
  assertPersistedLockAndDisplay();
  assertUndecidedCompleteUsesFinalFallback();
  assertCooldownRegression();
  assertWiring();
  console.log("security-wheel-prize-lock-at-start-check: OK");
}

main();
