import { prisma } from "@/lib/db";
import { addMinutesToDateTime } from "@/lib/datetime/date-layer";

export type ServiceTimingSource = "service" | "masterOverride";

export type ServiceTimingResult = {
  durationMinutes: number;
  breakAfterMinutes: number;
  totalBusyMinutes: number;
  source: ServiceTimingSource;
};

export async function resolveServiceTimingForMaster(
  masterId: string,
  serviceId: string,
): Promise<ServiceTimingResult | null> {
  const [service, masterService] = await Promise.all([
    prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        durationMinutes: true,
        breakAfterMinutes: true,
        isActive: true,
      },
    }),
    prisma.masterService.findUnique({
      where: {
        masterId_serviceId: { masterId, serviceId },
      },
      select: {
        isEnabled: true,
        durationMinutesOverride: true,
        breakAfterMinutesOverride: true,
      },
    }),
  ]);

  if (!service?.isActive) {
    return null;
  }

  if (masterService && !masterService.isEnabled) {
    return null;
  }

  const hasDurationOverride = masterService?.durationMinutesOverride != null;
  const hasBreakOverride = masterService?.breakAfterMinutesOverride != null;

  const durationMinutes = hasDurationOverride
    ? masterService!.durationMinutesOverride!
    : service.durationMinutes;

  const breakAfterMinutes = hasBreakOverride
    ? masterService!.breakAfterMinutesOverride!
    : service.breakAfterMinutes;

  return {
    durationMinutes,
    breakAfterMinutes,
    totalBusyMinutes: durationMinutes + breakAfterMinutes,
    source: hasDurationOverride || hasBreakOverride ? "masterOverride" : "service",
  };
}

export function calculateAppointmentEndsAt(
  startsAt: Date,
  durationMinutes: number,
  breakAfterMinutes: number,
): Date {
  return addMinutesToDateTime(
    startsAt,
    durationMinutes + breakAfterMinutes,
    startsAt,
  );
}
