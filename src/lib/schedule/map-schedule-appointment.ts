import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { parseAppliedPromotions } from "@/lib/promo/applied-promotions";
import type { ScheduleDayAppointment } from "@/types/schedule";
import type { Appointment, AppointmentSource, AppointmentStatus } from "@prisma/client";

type AppointmentWithService = Appointment & {
  service: { publicName: string } | null;
};

export function mapScheduleDayAppointment(
  appointment: AppointmentWithService,
): ScheduleDayAppointment {
  return {
    id: appointment.id,
    serviceId: appointment.serviceId,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    serviceName: appointment.service?.publicName ?? null,
    comment: appointment.comment,
    importantNote: appointment.importantNote,
    isBold: appointment.isBold,
    isManualTimeOverride: appointment.isManualTimeOverride,
    status: APPOINTMENT_STATUS_LABELS[appointment.status],
    source: APPOINTMENT_SOURCE_LABELS[appointment.source],
    statusCode: appointment.status,
    sourceCode: appointment.source,
    appliedPromotions: parseAppliedPromotions(appointment.appliedPromotions),
  };
}
