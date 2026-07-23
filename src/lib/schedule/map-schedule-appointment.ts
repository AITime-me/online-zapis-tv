import "server-only";

import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { normalizeMasterNote } from "@/lib/schedule/master-note-validation";
import { buildPromotionLabels } from "@/lib/schedule/promotion-labels";
import { parseAppliedPromotions } from "@/lib/promo/applied-promotions";
import { getAppointmentBusyInterval } from "@/lib/schedule/appointment-busy";
import type {
  ScheduleAppointmentMasterFields,
  ScheduleAppointmentOperationalFields,
  ScheduleAppointmentSharedFields,
  ScheduleAppointmentViewOnlyFields,
  ScheduleAppointmentVisibility,
} from "@/lib/schedule/appointment-contract";
import type { ScheduleDayAppointment } from "@/types/schedule";
import type { Appointment } from "@prisma/client";

type AppointmentWithService = Appointment & {
  service: { publicName: string } | null;
};

function mapSharedFields(
  appointment: AppointmentWithService,
): ScheduleAppointmentSharedFields {
  // Staff schedule shows busy free-at (v1 computed / v2 raw endsAt).
  const busy = getAppointmentBusyInterval({
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    timingSemanticsVersion: appointment.timingSemanticsVersion,
    breakAfterMinutes: appointment.breakAfterMinutes,
    standardBreakAfterMinutes: appointment.standardBreakAfterMinutes,
    standardDurationMinutes: appointment.standardDurationMinutes,
    isManualTimeOverride: appointment.isManualTimeOverride,
  });

  return {
    id: appointment.id,
    serviceId: appointment.serviceId,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: busy.endsAt.toISOString(),
    clientName: appointment.clientName,
    serviceName: appointment.service?.publicName ?? null,
    isBold: appointment.isBold,
    isManualTimeOverride: appointment.isManualTimeOverride,
    status: APPOINTMENT_STATUS_LABELS[appointment.status],
    source: APPOINTMENT_SOURCE_LABELS[appointment.source],
    statusCode: appointment.status,
    sourceCode: appointment.source,
  };
}

export function mapScheduleDayAppointmentViewOnly(
  appointment: AppointmentWithService,
): ScheduleAppointmentViewOnlyFields {
  return mapSharedFields(appointment);
}

export function mapScheduleDayAppointmentMaster(
  appointment: AppointmentWithService,
): ScheduleAppointmentMasterFields {
  const appliedPromotions = parseAppliedPromotions(appointment.appliedPromotions);

  return {
    ...mapSharedFields(appointment),
    promotionLabels: buildPromotionLabels(appliedPromotions),
    masterNote: normalizeMasterNote(appointment.importantNote),
  };
}

/** @deprecated Используйте mapScheduleDayAppointmentViewOnly или mapScheduleDayAppointmentMaster. */
export function mapScheduleDayAppointmentRestricted(
  appointment: AppointmentWithService,
): ScheduleAppointmentViewOnlyFields {
  return mapScheduleDayAppointmentViewOnly(appointment);
}

export function mapScheduleDayAppointmentOperational(
  appointment: AppointmentWithService,
): ScheduleAppointmentOperationalFields {
  return {
    ...mapSharedFields(appointment),
    clientPhone: appointment.clientPhone,
    comment: appointment.comment,
    importantNote: appointment.importantNote,
    appliedPromotions: parseAppliedPromotions(appointment.appliedPromotions),
    clientId: appointment.clientId ?? null,
  };
}

export function mapScheduleDayAppointment(
  appointment: AppointmentWithService,
  visibility: ScheduleAppointmentVisibility = "operational",
): ScheduleDayAppointment {
  if (visibility === "operational") {
    return mapScheduleDayAppointmentOperational(appointment);
  }

  if (visibility === "master") {
    return mapScheduleDayAppointmentMaster(appointment);
  }

  return mapScheduleDayAppointmentViewOnly(appointment);
}
