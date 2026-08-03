/**
 * Server-only attemptId hashing and deterministic session bearer derivation.
 * Plaintext attemptId is never persisted. Raw sessionToken is never persisted.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { hashOpaqueToken } from "@/lib/game/session/game-session-token";
import { isValidWheelAttemptId } from "@/lib/game/wheel/client-attempt-id";
import { resolveWheelHmacSecret } from "@/lib/game/wheel/wheel-env-contract";

export { isValidWheelAttemptId };

export const WHEEL_ATTEMPT_ID_HASH_VERSION = "v1" as const;
export const WHEEL_SESSION_TOKEN_VERSION = "v1" as const;

export function hashWheelAttemptId(
  attemptId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const id = attemptId.trim();
  if (!id) {
    throw new Error("attemptId is required");
  }
  return createHmac("sha256", resolveWheelHmacSecret(env))
    .update(`wheel-attempt-id|${WHEEL_ATTEMPT_ID_HASH_VERSION}|${id}`, "utf8")
    .digest("hex");
}

/**
 * Deterministic opaque bearer for one client attempt.
 * Same attemptId (+ catalog/campaign/phone hash) → same token.
 * Stored only as hashOpaqueToken(sessionToken).
 */
export function deriveWheelSessionToken(input: {
  attemptId: string;
  gameCatalogId: string;
  campaignKeySnapshot: string;
  participantPhoneHash: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const material = [
    "wheel-session-token",
    WHEEL_SESSION_TOKEN_VERSION,
    input.attemptId.trim(),
    input.gameCatalogId.trim(),
    input.campaignKeySnapshot.trim(),
    input.participantPhoneHash.trim(),
  ].join("|");

  return createHmac("sha256", resolveWheelHmacSecret(input.env))
    .update(material, "utf8")
    .digest("base64url");
}

export function deriveWheelSessionTokenHash(input: {
  attemptId: string;
  gameCatalogId: string;
  campaignKeySnapshot: string;
  participantPhoneHash: string;
  env?: NodeJS.ProcessEnv;
}): { sessionToken: string; tokenHash: string } {
  const sessionToken = deriveWheelSessionToken(input);
  return {
    sessionToken,
    tokenHash: hashOpaqueToken(sessionToken),
  };
}

export function attemptIdHashesEqual(
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
