/**
 * Phone participation isolation helpers (catalog × campaignKey).
 * Atomic enforcement lives in phone-attempt-registration + DB unique index.
 */

import {
  buildPhoneAttemptUniqueKey,
  type PhoneAttemptUniqueKey,
} from "@/lib/game/wheel/participant-phone-hash";

export type PhoneCampaignParticipationKey = {
  normalizedPhone: string;
  gameCatalogId: string;
  campaignKey: string | null;
};

export function participationKeysConflict(
  left: PhoneCampaignParticipationKey,
  right: PhoneCampaignParticipationKey,
  env?: NodeJS.ProcessEnv,
): boolean {
  if (left.gameCatalogId !== right.gameCatalogId) {
    return false;
  }
  const leftKey = buildPhoneAttemptUniqueKey({
    normalizedPhone: left.normalizedPhone,
    gameCatalogId: left.gameCatalogId,
    campaignKey: left.campaignKey,
    env,
  });
  const rightKey = buildPhoneAttemptUniqueKey({
    normalizedPhone: right.normalizedPhone,
    gameCatalogId: right.gameCatalogId,
    campaignKey: right.campaignKey,
    env,
  });
  return (
    leftKey.campaignKeySnapshot === rightKey.campaignKeySnapshot &&
    leftKey.participantPhoneHash === rightKey.participantPhoneHash
  );
}

/**
 * Pure pre-check helper. Production must still INSERT under unique constraint.
 */
export function phoneAttemptAllowed(input: {
  normalizedPhone: string;
  gameCatalogId: string;
  campaignKey: string | null;
  existingParticipations: PhoneCampaignParticipationKey[];
  env?: NodeJS.ProcessEnv;
}): boolean {
  const candidate: PhoneCampaignParticipationKey = {
    normalizedPhone: input.normalizedPhone,
    gameCatalogId: input.gameCatalogId,
    campaignKey: input.campaignKey,
  };
  return !input.existingParticipations.some((existing) =>
    participationKeysConflict(candidate, existing, input.env),
  );
}

export function toUniqueKey(
  input: PhoneCampaignParticipationKey,
  env?: NodeJS.ProcessEnv,
): PhoneAttemptUniqueKey {
  return buildPhoneAttemptUniqueKey({
    normalizedPhone: input.normalizedPhone,
    gameCatalogId: input.gameCatalogId,
    campaignKey: input.campaignKey,
    env,
  });
}
