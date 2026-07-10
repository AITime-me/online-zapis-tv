import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { resolveMasterWorkHours } from "@/lib/schedule/master-work-hours";
import { SEED_TEST_SERVICE_IDS } from "@/lib/services/seed-test-service-ids";
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";

export type EditorServiceOption = {
  id: string;
  publicName: string;
  durationMinutes: number;
  breakAfterMinutes: number;
  totalBusyMinutes: number;
  priceFrom: number | null;
  priceTo: number | null;
  unavailable?: boolean;
};

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return Number(value);
}

async function mapBookableServiceOption(
  masterId: string,
  entry: {
    serviceId: string;
    service: {
      id: string;
      publicName: string;
      durationMinutes: number;
      breakAfterMinutes: number;
      priceFrom: Prisma.Decimal | null;
      priceTo: Prisma.Decimal | null;
    };
  },
): Promise<EditorServiceOption> {
  const timing = await resolveServiceTimingForMaster(masterId, entry.serviceId);
  const durationMinutes =
    timing?.durationMinutes ?? entry.service.durationMinutes;
  const breakAfterMinutes =
    timing?.breakAfterMinutes ?? entry.service.breakAfterMinutes;

  return {
    id: entry.serviceId,
    publicName: entry.service.publicName,
    durationMinutes,
    breakAfterMinutes,
    totalBusyMinutes: durationMinutes + breakAfterMinutes,
    priceFrom: decimalToNumber(entry.service.priceFrom),
    priceTo: decimalToNumber(entry.service.priceTo),
  };
}

async function resolveIncludedServiceOption(
  masterId: string,
  serviceId: string,
): Promise<EditorServiceOption | null> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      publicName: true,
      durationMinutes: true,
      breakAfterMinutes: true,
      priceFrom: true,
      priceTo: true,
      isActive: true,
      isOnlineBookingEnabled: true,
    },
  });

  if (!service) {
    return null;
  }

  const masterService = await prisma.masterService.findUnique({
    where: {
      masterId_serviceId: { masterId, serviceId },
    },
    select: { isEnabled: true, isOnlineBookingEnabled: true },
  });

  const timing = await resolveServiceTimingForMaster(masterId, serviceId);
  const durationMinutes = timing?.durationMinutes ?? service.durationMinutes;
  const breakAfterMinutes =
    timing?.breakAfterMinutes ?? service.breakAfterMinutes;

  const isBookable =
    service.isActive &&
    service.isOnlineBookingEnabled &&
    masterService?.isEnabled === true &&
    masterService.isOnlineBookingEnabled === true &&
    timing != null;

  return {
    id: service.id,
    publicName: isBookable
      ? service.publicName
      : `${service.publicName} (текущая, недоступна для новых записей)`,
    durationMinutes,
    breakAfterMinutes,
    totalBusyMinutes: durationMinutes + breakAfterMinutes,
    priceFrom: decimalToNumber(service.priceFrom),
    priceTo: decimalToNumber(service.priceTo),
    unavailable: !isBookable,
  };
}

export async function listBookableServicesForMaster(
  masterId: string,
): Promise<EditorServiceOption[]> {
  const masterServices = await prisma.masterService.findMany({
    where: {
      masterId,
      isEnabled: true,
      isOnlineBookingEnabled: true,
      service: {
        isActive: true,
        isOnlineBookingEnabled: true,
        id: { notIn: [...SEED_TEST_SERVICE_IDS] },
      },
    },
    include: {
      service: {
        select: {
          id: true,
          publicName: true,
          durationMinutes: true,
          breakAfterMinutes: true,
          priceFrom: true,
          priceTo: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { service: { publicName: "asc" } }],
  });

  return Promise.all(
    masterServices.map((entry) => mapBookableServiceOption(masterId, entry)),
  );
}

export async function getScheduleEditorOptions(
  masterId: string,
  dateKey: string,
  includeServiceId?: string | null,
) {
  const master = await prisma.master.findUnique({
    where: { id: masterId },
    select: {
      id: true,
      workStart: true,
      workEnd: true,
      usesDefaultWorkHours: true,
    },
  });

  if (!master) {
    return null;
  }

  const workHours = resolveMasterWorkHours(master, dateKey);
  const services = await listBookableServicesForMaster(masterId);

  if (
    includeServiceId &&
    !services.some((service) => service.id === includeServiceId)
  ) {
    const included = await resolveIncludedServiceOption(
      masterId,
      includeServiceId,
    );
    if (included) {
      services.unshift(included);
    }
  }

  return {
    master: {
      workStart: workHours.workStart,
      workEnd: workHours.workEnd,
    },
    services,
    statuses: Object.entries(APPOINTMENT_STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
    sources: Object.entries(APPOINTMENT_SOURCE_LABELS).map(
      ([value, label]) => ({ value, label }),
    ),
  };
}
