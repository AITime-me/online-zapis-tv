/**
 * Test-only hooks / barriers for CURSOR-24 concurrency proofs.
 * Never active when NODE_ENV=production.
 * Require SECURITY_BATCH_TEST=1 otherwise.
 */
export type BotBookingCreateTestHooks = {
  /** Very start of createBotConfirmedBooking (after fingerprint, before claim). */
  beforeCreate?: (() => Promise<void> | void) | null;
  /** After successful idempotency claim (kind=claimed). */
  afterClaim?: (() => Promise<void> | void) | null;
  /** After availability checks, immediately before Serializable write. */
  beforeSerializableWrite?: (() => Promise<void> | void) | null;
  /**
   * Start of client resolution, before advisory lock — Race E sync point.
   * Production lock semantics are unchanged; hook only runs in test mode.
   */
  beforeClientResolve?: (() => Promise<void> | void) | null;
  /**
   * Inside client resolution after confirming zero matches, before createClientFromLead.
   * Note: runs while holding advisory lock; do not barrier here for multi-waiter races.
   */
  beforeZeroClientCreate?: (() => Promise<void> | void) | null;
  /** After client resolve (Race G rollback). May throw. */
  afterClientResolve?: (() => void) | null;
};

let hooks: BotBookingCreateTestHooks = {};

export function botBookingCreateTestHooksAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  return env.SECURITY_BATCH_TEST === "1";
}

export function assertBotBookingCreateTestHooksAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!botBookingCreateTestHooksAllowed(env)) {
    throw new Error("BOT_BOOKING_CREATE_TEST_HOOK_DISABLED");
  }
}

export function setBotBookingCreateTestHooks(
  next: BotBookingCreateTestHooks | null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertBotBookingCreateTestHooksAllowed(env);
  hooks = next ? { ...next } : {};
}

export function clearBotBookingCreateTestHooks(): void {
  hooks = {};
}

export function getBotBookingCreateTestHooks(): BotBookingCreateTestHooks {
  if (!botBookingCreateTestHooksAllowed()) {
    return {};
  }
  return hooks;
}

/**
 * Countdown barrier: N waiters block until all have entered, then release together.
 */
export function createCountdownBarrier(
  participantCount: number,
  timeoutMs = 8_000,
): {
  wait: () => Promise<void>;
  cancel: () => void;
} {
  if (participantCount < 2) {
    throw new Error("countdown barrier requires >= 2 participants");
  }

  let arrived = 0;
  let opened = false;
  let failure: Error | null = null;
  const waiters: Array<() => void> = [];

  const timer = setTimeout(() => {
    failure = new Error("BOT_BOOKING_CREATE_BARRIER_TIMEOUT");
    for (const wake of waiters) wake();
  }, timeoutMs);
  timer.unref?.();

  return {
    wait: () =>
      new Promise<void>((resolve, reject) => {
        if (failure) {
          reject(failure);
          return;
        }
        if (opened) {
          resolve();
          return;
        }
        arrived += 1;
        waiters.push(() => {
          if (failure) reject(failure);
          else resolve();
        });
        if (arrived >= participantCount) {
          opened = true;
          clearTimeout(timer);
          for (const wake of waiters) wake();
        }
      }),
    cancel: () => {
      failure = new Error("BOT_BOOKING_CREATE_BARRIER_CANCELLED");
      clearTimeout(timer);
      for (const wake of waiters) wake();
    },
  };
}
