/**
 * Server-only irreversible participant phone hash for wheel attempt uniqueness.
 * Never log plaintext phone, hash, or secret. Never use NEXT_PUBLIC_*.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveWheelHmacSecret } from "@/lib/game/wheel/wheel-env-contract";

export const WHEEL_PHONE_ATTEMPT_HASH_VERSION = "v1" as const;
export const GAME_SESSION_PHONE_CAMPAIGN_UNIQUE_INDEX =
  "game_sessions_catalog_campaign_phone_hash_uidx";

/**
 * Stable non-empty campaign snapshot for uniqueness.
 * Never leave null when registering a phone-bound wheel attempt.
 */
export function resolveCampaignKeySnapshot(
  campaignKey: string | null | undefined,
  gameCatalogId: string,
): string {
  const trimmed = campaignKey?.trim();
  if (trimmed) {
    return trimmed.slice(0, 64);
  }
  const catalog = gameCatalogId.trim();
  return `catalog:${catalog}`.slice(0, 64);
}

/**
 * HMAC-SHA256 hex (64 chars). Scoped to catalog + campaign + normalized phone.
 */
export function hashParticipantPhone(input: {
  normalizedPhone: string;
  gameCatalogId: string;
  campaignKeySnapshot: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const phone = input.normalizedPhone.trim();
  const catalog = input.gameCatalogId.trim();
  const campaign = input.campaignKeySnapshot.trim();
  if (!phone || !catalog || !campaign) {
    throw new Error("hashParticipantPhone requires phone, catalog, and campaign");
  }

  const material = [
    "wheel-phone-attempt",
    WHEEL_PHONE_ATTEMPT_HASH_VERSION,
    catalog,
    campaign,
    phone,
  ].join("|");

  return createHmac("sha256", resolveWheelHmacSecret(input.env))
    .update(material, "utf8")
    .digest("hex");
}

export function participantPhoneHashesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export type PhoneAttemptUniqueKey = {
  gameCatalogId: string;
  campaignKeySnapshot: string;
  participantPhoneHash: string;
};

export function buildPhoneAttemptUniqueKey(input: {
  normalizedPhone: string;
  gameCatalogId: string;
  campaignKey: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): PhoneAttemptUniqueKey {
  const campaignKeySnapshot = resolveCampaignKeySnapshot(
    input.campaignKey,
    input.gameCatalogId,
  );
  return {
    gameCatalogId: input.gameCatalogId.trim(),
    campaignKeySnapshot,
    participantPhoneHash: hashParticipantPhone({
      normalizedPhone: input.normalizedPhone,
      gameCatalogId: input.gameCatalogId,
      campaignKeySnapshot,
      env: input.env,
    }),
  };
}

export function isWheelPhoneCampaignUniqueTarget(
  target: string | string[] | null | undefined,
): boolean {
  if (!target) {
    return false;
  }
  if (typeof target === "string") {
    return (
      target === GAME_SESSION_PHONE_CAMPAIGN_UNIQUE_INDEX ||
      target.includes("catalog_campaign_phone_hash")
    );
  }
  const normalized = target.map((part) =>
    part.replace(/_/g, "").replace(/"/g, "").toLowerCase(),
  );
  const joined = normalized.join("|");
  return (
    joined.includes("gamecatalogid") &&
    joined.includes("campaignkeysnapshot") &&
    joined.includes("participantphonehash")
  );
}
