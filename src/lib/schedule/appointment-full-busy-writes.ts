/**
 * Feature flag: when true, standard writes store endsAt as free-at (v2).
 * Enabled only when env string is exactly "true". Default: false.
 */
export function isAppointmentFullBusyEndWritesEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env.APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED === "true";
}

/** Safe container/runtime verification label — no secrets. */
export function formatFullBusyWritesRuntimeLabel(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): "FULL_BUSY_WRITES_ON" | "FULL_BUSY_WRITES_OFF" {
  return isAppointmentFullBusyEndWritesEnabled(env)
    ? "FULL_BUSY_WRITES_ON"
    : "FULL_BUSY_WRITES_OFF";
}
