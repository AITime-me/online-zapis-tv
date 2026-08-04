/**
 * Wheel phone replay cooldown — one attempt per catalog+campaign+phone
 * every WHEEL_REPLAY_COOLDOWN_MS (14 days). Server-only helpers.
 */
import "server-only";

import { createHash } from "node:crypto";
import {
  formatStudioDate,
  formatStudioTime,
} from "@/lib/datetime/date-layer";

/** Exactly 14 × 24 hours. Replay is allowed at startedAt + this duration. */
export const WHEEL_REPLAY_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export const GAME_SESSION_PHONE_CAMPAIGN_STARTED_INDEX =
  "game_sessions_catalog_campaign_phone_started_idx";

/** Former lifetime unique index — dropped by cooldown migration. */
export const GAME_SESSION_PHONE_CAMPAIGN_UNIQUE_INDEX_LEGACY =
  "game_sessions_catalog_campaign_phone_hash_uidx";

export function computeWheelReplayRetryAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + WHEEL_REPLAY_COOLDOWN_MS);
}

/**
 * Cooldown is active while now is strictly before startedAt + 14 days.
 * At exactly startedAt + 14d a new attempt is allowed.
 */
export function isWheelReplayCooldownActive(
  startedAt: Date,
  now: Date,
): boolean {
  return now.getTime() < computeWheelReplayRetryAt(startedAt).getTime();
}

export function formatWheelCooldownMessage(retryAt: Date): string {
  return `Вы уже участвовали. Повторно сыграть можно после ${formatStudioDate(retryAt)} в ${formatStudioTime(retryAt)}.`;
}

/**
 * Deterministic transaction-scoped advisory lock key for one logical participant.
 * Uses first 8 bytes of SHA-256 as signed bigint for pg_advisory_xact_lock(bigint).
 */
export function buildWheelPhoneParticipantLockKey(input: {
  gameCatalogId: string;
  campaignKeySnapshot: string;
  participantPhoneHash: string;
}): bigint {
  const material = [
    "wheel-phone-replay-lock",
    input.gameCatalogId.trim(),
    input.campaignKeySnapshot.trim(),
    input.participantPhoneHash.trim(),
  ].join("|");
  const digest = createHash("sha256").update(material, "utf8").digest();
  return digest.readBigInt64BE(0);
}
