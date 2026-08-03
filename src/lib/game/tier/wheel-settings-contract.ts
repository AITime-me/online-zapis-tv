/** Re-export wheel settings contract for tier package compatibility. */
export {
  type WheelSettingsV1,
  WHEEL_SETTINGS_VERSION,
  WHEEL_DEFAULT_EXPECTED_SECTORS,
  defaultWheelSettings,
  parseWheelSettings,
} from "@/lib/game/wheel/wheel-settings";
