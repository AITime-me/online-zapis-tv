/**
 * Test-only hooks / barriers for BookingRequest book_from_request races.
 * Never active when NODE_ENV=production.
 * Require SECURITY_BATCH_TEST=1 otherwise.
 *
 * Reuses the same countdown-barrier pattern as CURSOR-24 booking create.
 */
import {
  createCountdownBarrier as createSharedCountdownBarrier,
} from "@/lib/bot-api/booking-create-test-hooks";

export type BotBookingRequestTestHooks = {
  /** After availability checks, immediately before Serializable write. */
  beforeSerializableWrite?: (() => Promise<void> | void) | null;
};

let hooks: BotBookingRequestTestHooks = {};

export function botBookingRequestTestHooksAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  return env.SECURITY_BATCH_TEST === "1";
}

export function assertBotBookingRequestTestHooksAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!botBookingRequestTestHooksAllowed(env)) {
    throw new Error("BOT_BOOKING_REQUEST_TEST_HOOK_DISABLED");
  }
}

export function setBotBookingRequestTestHooks(
  next: BotBookingRequestTestHooks | null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertBotBookingRequestTestHooksAllowed(env);
  hooks = next ? { ...next } : {};
}

export function clearBotBookingRequestTestHooks(): void {
  hooks = {};
}

export function getBotBookingRequestTestHooks(): BotBookingRequestTestHooks {
  if (!botBookingRequestTestHooksAllowed()) {
    return {};
  }
  return hooks;
}

export function createCountdownBarrier(
  participantCount: number,
  timeoutMs = 8_000,
): {
  wait: () => Promise<void>;
  cancel: () => void;
} {
  return createSharedCountdownBarrier(participantCount, timeoutMs);
}
