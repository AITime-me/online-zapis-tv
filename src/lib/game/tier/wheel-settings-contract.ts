/** Future wheel mechanic contracts — not used by CATCH_TIME in C2.1. */
export type WheelSettingsV1 = {
  sectors: Array<{
    sectorIndex: number;
    label: string;
    tier: number;
    weight: number;
  }>;
  spinDurationMs?: number;
};
