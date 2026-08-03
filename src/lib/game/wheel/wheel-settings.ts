/**
 * Wheel-specific GameCatalog.settings.wheel contract.
 * Critical business rules for prizes live on GameGift.prizeRules + snapshots.
 */

export const WHEEL_SETTINGS_VERSION = 1 as const;
export const WHEEL_DEFAULT_EXPECTED_SECTORS = 16;
export const WHEEL_MIN_WINDOW_DAYS = 1;
export const WHEEL_MAX_WINDOW_DAYS = 365;

export type WheelSettingsV1 = {
  version: 1;
  expectedSectorCount: number;
  confirmWindowDays: number;
  procedureWindowDays: number;
  /** Optional UI spin duration hint for future public renderer. */
  spinDurationMs?: number;
};

export type ParsedWheelSettings =
  | { status: "valid"; settings: WheelSettingsV1 }
  | { status: "safe-default"; settings: WheelSettingsV1 }
  | { status: "invalid"; settings: null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const n = Math.trunc(value);
  if (n < WHEEL_MIN_WINDOW_DAYS || n > max) {
    return null;
  }
  return n;
}

export function defaultWheelSettings(): WheelSettingsV1 {
  return {
    version: WHEEL_SETTINGS_VERSION,
    expectedSectorCount: WHEEL_DEFAULT_EXPECTED_SECTORS,
    confirmWindowDays: 7,
    procedureWindowDays: 30,
  };
}

export function parseWheelSettings(raw: unknown): ParsedWheelSettings {
  if (raw === null || raw === undefined) {
    return { status: "safe-default", settings: defaultWheelSettings() };
  }

  if (!isPlainObject(raw)) {
    return { status: "invalid", settings: null };
  }

  if (raw.version !== WHEEL_SETTINGS_VERSION) {
    return { status: "invalid", settings: null };
  }

  const expectedSectorCount = readPositiveInt(
    raw.expectedSectorCount ?? WHEEL_DEFAULT_EXPECTED_SECTORS,
    64,
  );
  if (expectedSectorCount === null) {
    return { status: "invalid", settings: null };
  }

  const confirmWindowDays = readPositiveInt(
    raw.confirmWindowDays ?? 7,
    WHEEL_MAX_WINDOW_DAYS,
  );
  const procedureWindowDays = readPositiveInt(
    raw.procedureWindowDays ?? 30,
    WHEEL_MAX_WINDOW_DAYS,
  );
  if (confirmWindowDays === null || procedureWindowDays === null) {
    return { status: "invalid", settings: null };
  }

  let spinDurationMs: number | undefined;
  if (raw.spinDurationMs !== undefined && raw.spinDurationMs !== null) {
    const parsed = readPositiveInt(raw.spinDurationMs, 120_000);
    if (parsed === null) {
      return { status: "invalid", settings: null };
    }
    spinDurationMs = parsed;
  }

  return {
    status: "valid",
    settings: {
      version: 1,
      expectedSectorCount,
      confirmWindowDays,
      procedureWindowDays,
      ...(spinDurationMs !== undefined ? { spinDurationMs } : {}),
    },
  };
}

export function resolveWheelSettingsFromCatalogSettings(
  catalogSettingsRaw: unknown,
): ParsedWheelSettings {
  if (!isPlainObject(catalogSettingsRaw)) {
    return { status: "safe-default", settings: defaultWheelSettings() };
  }
  return parseWheelSettings(catalogSettingsRaw.wheel);
}
