/**
 * Canonical runtime feature-flag marker. This module is also copied into the
 * standalone app image and executed by deploy verification inside the running
 * container.
 */
import { pathToFileURL } from "node:url";

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isAppointmentFullBusyEndWritesEnabledRuntime(env = process.env) {
  return env.APPOINTMENT_FULL_BUSY_END_WRITES_ENABLED === "true";
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {"FULL_BUSY_WRITES_ON" | "FULL_BUSY_WRITES_OFF"}
 */
export function formatFullBusyWritesRuntimeMarker(env = process.env) {
  return isAppointmentFullBusyEndWritesEnabledRuntime(env)
    ? "FULL_BUSY_WRITES_ON"
    : "FULL_BUSY_WRITES_OFF";
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.stdout.write(formatFullBusyWritesRuntimeMarker());
}
