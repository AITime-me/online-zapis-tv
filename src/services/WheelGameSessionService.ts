import "server-only";

/**
 * Server-only entry for wheel phone-bound session registration.
 * Public WHEEL_OF_FORTUNE routes remain blocked until stage 2.
 */
export {
  registerWheelPhoneBoundSession,
  type RegisterWheelPhoneBoundSessionInput,
  type RegisterWheelPhoneBoundSessionResult,
  type WheelSessionPublicDto,
} from "@/lib/game/wheel/register-phone-bound-session";
