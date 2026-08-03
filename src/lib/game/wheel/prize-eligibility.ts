import type { PrizeRulesV1 } from "@/lib/game/wheel/prize-rules-contract";
import type { WheelProcedureType } from "@/lib/game/wheel/procedure-types";

export type PrizeEligibilityResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Cover of another artist's work is a participating primary-like procedure
 * when listed in applicableProcedures (default for discounts/gifts).
 */
export function isPrizeAllowedForProcedure(
  rules: PrizeRulesV1,
  procedure: WheelProcedureType,
): PrizeEligibilityResult {
  if (rules.excludedProcedures.includes(procedure)) {
    return {
      ok: false,
      reason: `Приз не действует на процедуру «${procedure}»`,
    };
  }

  if (rules.applicableProcedures.length === 0) {
    return { ok: false, reason: "Для приза не заданы применимые процедуры" };
  }

  if (!rules.applicableProcedures.includes(procedure)) {
    return {
      ok: false,
      reason: `Приз не применим к процедуре «${procedure}»`,
    };
  }

  if (rules.zoneRestriction === "lips") {
    const lipsOk =
      procedure === "lips_permanent_primary" ||
      procedure === "lips_cover" ||
      procedure === "lips_refresh";
    if (!lipsOk) {
      return {
        ok: false,
        reason: "Приз ограничен зоной губ",
      };
    }
  }

  return { ok: true };
}

export function assertCorrectionForbidden(rules: PrizeRulesV1): boolean {
  return (
    rules.excludedProcedures.includes("correction") &&
    rules.excludedProcedures.includes("lips_correction") &&
    !rules.applicableProcedures.includes("correction") &&
    !rules.applicableProcedures.includes("lips_correction")
  );
}
