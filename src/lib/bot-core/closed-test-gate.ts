import type { BotMode } from "@/lib/bot-settings/defaults";

export type ClosedTestGateSettings = {
  mode: BotMode;
  isEnabled: boolean;
};

export type ClosedTestGateDenial =
  | "CLOSED_TEST_MODE_REQUIRED"
  | "CLOSED_TEST_NOT_ENABLED";

/**
 * Closed-test is allowed only for saved control-plane settings:
 * mode === "TEST" && isEnabled === true.
 * Auth/OWNER is enforced separately at the API layer.
 */
export function evaluateClosedTestAdminGate(
  settings: ClosedTestGateSettings,
): { ok: true } | { ok: false; code: ClosedTestGateDenial } {
  if (settings.mode !== "TEST") {
    return { ok: false, code: "CLOSED_TEST_MODE_REQUIRED" };
  }
  if (!settings.isEnabled) {
    return { ok: false, code: "CLOSED_TEST_NOT_ENABLED" };
  }
  return { ok: true };
}

export function isClosedTestConsoleVisible(
  settings: ClosedTestGateSettings,
): boolean {
  return evaluateClosedTestAdminGate(settings).ok;
}
