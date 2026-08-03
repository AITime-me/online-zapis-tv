/**
 * Pure wheel session completion helpers (stage 1 foundation).
 * Public routes still reject WHEEL_OF_FORTUNE activation; these functions
 * are the protected core that stage 2 will wire into GameSessionService.
 */

import type { GiftSnapshot } from "@/lib/game/session/game-session-snapshot";
import { buildGiftSnapshot } from "@/lib/game/session/game-session-snapshot";
import { assertCompleteUsesServerWheelAssignment } from "@/lib/game/wheel/forbidden-client-fields";
import { parsePrizeRules } from "@/lib/game/wheel/prize-rules-contract";
import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";
import { buildWheelGiftSnapshotFields } from "@/lib/game/wheel/wheel-gift-snapshot";
import type { GamePrizeType } from "@/lib/game/wheel/prize-types";
import { isGamePrizeType } from "@/lib/game/wheel/prize-types";

export type WheelCompleteGiftSource = {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
  activationMode: "SINGLE_PAID_SERVICE" | "COURSE_MIN_SESSIONS";
  minCourseSessions: number | null;
  activationConditionText: string;
  systemKey: string | null;
  prizeType: string | null;
  prizeRules: unknown;
};

export type WheelCompleteResult =
  | {
      ok: true;
      idempotent: boolean;
      giftSnapshot: GiftSnapshot & Record<string, unknown>;
      assignment: WheelServerAssignmentV1;
    }
  | { ok: false; error: string };

/**
 * Resolve play result from persisted server assignment only.
 * Re-complete returns the same snapshot — never a new prize roll.
 */
export function completeWheelFromServerAssignment(input: {
  assignment: WheelServerAssignmentV1;
  gifts: WheelCompleteGiftSource[];
  existingGiftSnapshot: unknown | null;
  clientBody: Record<string, unknown>;
  now: Date;
}): WheelCompleteResult {
  const guard = assertCompleteUsesServerWheelAssignment({
    clientSectorIndex: input.clientBody.sectorIndex ?? input.clientBody.sectorId,
    clientPrizeId: input.clientBody.prizeId,
    clientGiftId: input.clientBody.giftId,
    serverSectorIndex: input.assignment.sectorIndex,
    serverGiftId: input.assignment.giftId,
  });
  if (!guard.ok) {
    return guard;
  }

  if (
    input.clientBody.prizeSystemKey !== undefined &&
    input.clientBody.prizeSystemKey !== input.assignment.prizeSystemKey
  ) {
    return { ok: false, error: "prizeSystemKey не поддерживается" };
  }

  if (input.existingGiftSnapshot) {
    return {
      ok: true,
      idempotent: true,
      giftSnapshot: input.existingGiftSnapshot as GiftSnapshot &
        Record<string, unknown>,
      assignment: input.assignment,
    };
  }

  const gift = input.gifts.find((g) => g.id === input.assignment.giftId);
  if (!gift) {
    return { ok: false, error: "Назначенный приз недоступен" };
  }
  if (gift.systemKey !== input.assignment.prizeSystemKey) {
    return { ok: false, error: "Назначенный приз недоступен" };
  }

  const prizeType: GamePrizeType | null = isGamePrizeType(gift.prizeType)
    ? gift.prizeType
    : null;
  const prizeRules = parsePrizeRules(gift.prizeRules);
  if (!prizeType || !prizeRules) {
    return { ok: false, error: "Правила приза недоступны" };
  }

  const base = buildGiftSnapshot(gift, input.now);
  const wheelFields = buildWheelGiftSnapshotFields({
    prizeType,
    systemKey: input.assignment.prizeSystemKey,
    sectorIndex: input.assignment.sectorIndex,
    totalSectors: input.assignment.totalSectors,
    prizeRules,
    giftId: gift.id,
    name: gift.name,
  });

  return {
    ok: true,
    idempotent: false,
    giftSnapshot: {
      ...base,
      ...wheelFields,
      ruleType: "wheel_sector",
    },
    assignment: input.assignment,
  };
}
