/**
 * Test-only hooks / barriers for CURSOR-26 Master Command concurrency proofs.
 * Never active when NODE_ENV=production.
 * Require SECURITY_BATCH_TEST=1 otherwise.
 */
export type MasterCommandTestHooks = {
  beforeSerializableWrite?: (() => Promise<void> | void) | null;
  beforeClientResolve?: (() => Promise<void> | void) | null;
};

let hooks: MasterCommandTestHooks = {};

export function masterCommandTestHooksAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  return env.SECURITY_BATCH_TEST === "1";
}

export function assertMasterCommandTestHooksAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!masterCommandTestHooksAllowed(env)) {
    throw new Error("MASTER_COMMAND_TEST_HOOK_DISABLED");
  }
}

export function setMasterCommandTestHooks(
  next: MasterCommandTestHooks | null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertMasterCommandTestHooksAllowed(env);
  hooks = next ? { ...next } : {};
}

export function clearMasterCommandTestHooks(): void {
  hooks = {};
}

export function getMasterCommandTestHooks(): MasterCommandTestHooks {
  if (!masterCommandTestHooksAllowed()) {
    return {};
  }
  return hooks;
}

export {
  createCountdownBarrier,
} from "@/lib/bot-api/booking-create-test-hooks";
