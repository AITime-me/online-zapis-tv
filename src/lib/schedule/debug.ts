export function isScheduleDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SCHEDULE_DEBUG === "true";
}
