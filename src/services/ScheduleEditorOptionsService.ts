import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { internalEditorMasterServiceWhere } from "@/lib/schedule/internal-editor-master-service";
import { resolveMasterWorkHours } from "@/lib/schedule/master-work-hours";
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

export async function listBookableServicesForMaster(
  masterId: string,
): Promise<EditorServiceOption[]> {
  const masterServices = await prisma.masterService.findMany({
    where: internalEditorMasterServiceWhere(masterId),
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
