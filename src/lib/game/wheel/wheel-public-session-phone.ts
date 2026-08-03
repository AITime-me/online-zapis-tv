import "server-only";

import { normalizeGameBookingPhoneKey } from "@/lib/game/game-open-request-policy";
import {
  hashParticipantPhone,
  participantPhoneHashesEqual,
} from "@/lib/game/wheel/participant-phone-hash";

export function assertWheelSessionPhoneMatches(input: {
  participantPhoneHash: string | null;
  campaignKeySnapshot: string | null;
  gameCatalogId: string;
  phone: string;
  env?: NodeJS.ProcessEnv;
}): { ok: true; canonicalPhone: string } | { ok: false; code: string } {
  const canonicalPhone = normalizeGameBookingPhoneKey(input.phone);
  if (!canonicalPhone) {
    return { ok: false, code: "GAME_INVALID_REQUEST" };
  }

  const storedHash = input.participantPhoneHash?.trim() ?? "";
  const campaignSnapshot = input.campaignKeySnapshot?.trim() ?? "";
  if (!storedHash || !campaignSnapshot) {
    return { ok: false, code: "RESULT_UNAVAILABLE" };
  }

  let expectedHash: string;
  try {
    expectedHash = hashParticipantPhone({
      normalizedPhone: canonicalPhone,
      gameCatalogId: input.gameCatalogId,
      campaignKeySnapshot: campaignSnapshot,
      env: input.env,
    });
  } catch {
    return { ok: false, code: "GAME_UNAVAILABLE" };
  }

  if (!participantPhoneHashesEqual(storedHash, expectedHash)) {
    return { ok: false, code: "GAME_SESSION_FORBIDDEN" };
  }

  return { ok: true, canonicalPhone };
}
