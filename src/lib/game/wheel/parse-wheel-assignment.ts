import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";
import { parseWheelClaimLock } from "@/lib/game/wheel/wheel-claim-lock";
import { parseWheelAssignmentPrizeSnapshot } from "@/lib/game/wheel/wheel-assignment-prize-snapshot";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDate(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function parseWheelServerAssignment(
  raw: unknown,
): WheelServerAssignmentV1 | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.version !== 1) {
    return null;
  }
  if (raw.mechanicType !== "WHEEL_OF_FORTUNE") {
    return null;
  }
  if (raw.serverResultTier !== 0) {
    return null;
  }
  if (raw.campaignKey !== null && typeof raw.campaignKey !== "string") {
    return null;
  }
  if (typeof raw.rulesVersion !== "string" || !raw.rulesVersion.trim()) {
    return null;
  }
  if (typeof raw.assignedAt !== "string" || !isValidIsoDate(raw.assignedAt)) {
    return null;
  }
  if (raw.tierBucket !== "tier-0") {
    return null;
  }
  if (
    typeof raw.sectorIndex !== "number" ||
    !Number.isInteger(raw.sectorIndex) ||
    raw.sectorIndex < 0
  ) {
    return null;
  }
  if (
    typeof raw.totalSectors !== "number" ||
    !Number.isInteger(raw.totalSectors) ||
    raw.totalSectors < 1
  ) {
    return null;
  }
  if (raw.sectorIndex >= raw.totalSectors) {
    return null;
  }
  if (typeof raw.prizeSystemKey !== "string" || !raw.prizeSystemKey.trim()) {
    return null;
  }
  if (typeof raw.giftId !== "string" || !raw.giftId.trim()) {
    return null;
  }

  const prizeSnapshot = parseWheelAssignmentPrizeSnapshot(raw.prizeSnapshot);
  if (!prizeSnapshot) {
    return null;
  }

  const claimLock =
    raw.claimLock === undefined ? undefined : parseWheelClaimLock(raw.claimLock);
  if (raw.claimLock !== undefined && !claimLock) {
    return null;
  }

  return {
    version: 1,
    mechanicType: "WHEEL_OF_FORTUNE",
    serverResultTier: 0,
    campaignKey: raw.campaignKey,
    rulesVersion: raw.rulesVersion.trim(),
    assignedAt: raw.assignedAt,
    tierBucket: "tier-0",
    sectorIndex: raw.sectorIndex,
    totalSectors: raw.totalSectors,
    prizeSystemKey: raw.prizeSystemKey.trim(),
    giftId: raw.giftId.trim(),
    prizeSnapshot,
    ...(claimLock ? { claimLock } : {}),
  };
}
