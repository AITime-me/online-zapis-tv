import { randomBytes } from "node:crypto";
import type { Appointment, AppointmentSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  formatDateKeyInStudio,
  formatDateKeyLabel,
  formatStudioTimeInput,
  getStudioNow,
} from "@/lib/datetime/date-layer";

export type PublicManageAppointmentStatus = "active" | "cancelled" | "completed";

export type PublicManageAppointmentView = {
  serviceName: string;
  masterName: string;
  dateLabel: string;
  timeLabel: string;
  durationMinutes: number;
  status: PublicManageAppointmentStatus;
  statusLabel: string;
  sourceLabel: string;
  confirmationNote: string | null;
  canCancel: boolean;
  canRequestReschedule: boolean;
  rescheduleRequested: boolean;
};

export class BookingManageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingManageError";
  }
}

export function createManageToken(): string {
  return randomBytes(32).toString("base64url");
}

export function buildManageUrl(token: string): string {
  return `/booking/manage?token=${encodeURIComponent(token)}`;
}

type AppointmentWithRelations = Appointment & {
  master: { publicName: string };
  service: { publicName: string; durationMinutes: number } | null;
};

function resolvePublicStatus(
  appointment: Appointment,
  now: Date = getStudioNow(),
): PublicManageAppointmentStatus {
  if (appointment.status === "CANCELLED") {
    return "cancelled";
  }

  if (appointment.endsAt < now) {
    return "completed";
  }

  return "active";
}

function resolveStatusLabel(status: PublicManageAppointmentStatus): string {
  switch (status) {
    case "cancelled":
      return "Запись отменена";
    case "completed":
      return "Запись уже прошла";
    default:
      return "Ваша запись активна";
  }
}

function resolveSourceLabel(source: AppointmentSource): string {
  if (source === "ONLINE") {
    return "Онлайн-запись";
  }
  return "Запись в студии";
}

function resolveConfirmationNote(
  appointment: Appointment,
  publicStatus: PublicManageAppointmentStatus,
): string | null {
  if (publicStatus !== "active") {
    return null;
  }

  if (appointment.source === "ONLINE" && appointment.status === "SCHEDULED") {
    return "Запись ожидает подтверждения менеджером студии.";
  }

  return null;
}

function canManageActiveAppointment(
  appointment: Appointment,
  publicStatus: PublicManageAppointmentStatus,
): boolean {
  if (publicStatus !== "active") {
    return false;
  }

  return appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED";
}

function mapPublicManageView(appointment: AppointmentWithRelations): PublicManageAppointmentView {
  const publicStatus = resolvePublicStatus(appointment);
  const canManage = canManageActiveAppointment(appointment, publicStatus);
  const durationMinutes =
    appointment.serviceDurationMinutes ??
    appointment.service?.durationMinutes ??
    0;

  return {
    serviceName: appointment.service?.publicName ?? "Услуга",
    masterName: appointment.master.publicName,
    dateLabel: formatDateKeyLabel(formatDateKeyInStudio(appointment.startsAt)),
    timeLabel: formatStudioTimeInput(appointment.startsAt),
    durationMinutes,
    status: publicStatus,
    statusLabel: resolveStatusLabel(publicStatus),
    sourceLabel: resolveSourceLabel(appointment.source),
    confirmationNote: resolveConfirmationNote(appointment, publicStatus),
    canCancel: canManage,
    canRequestReschedule: canManage,
    rescheduleRequested: Boolean(appointment.rescheduleRequestedAt),
  };
}

async function findAppointmentByManageToken(
  token: string,
): Promise<AppointmentWithRelations | null> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return null;
  }

  return prisma.appointment.findUnique({
    where: { manageToken: normalizedToken },
    include: {
      master: { select: { publicName: true } },
      service: { select: { publicName: true, durationMinutes: true } },
    },
  });
}

export async function getPublicManageAppointmentByToken(
  token: string,
): Promise<PublicManageAppointmentView | null> {
  const appointment = await findAppointmentByManageToken(token);
  if (!appointment) {
    return null;
  }

  return mapPublicManageView(appointment);
}

export async function cancelAppointmentByManageToken(
  token: string,
  reason?: string | null,
): Promise<{ view: PublicManageAppointmentView; alreadyCancelled: boolean }> {
  const appointment = await findAppointmentByManageToken(token);
  if (!appointment) {
    throw new BookingManageError("Запись не найдена");
  }

  if (appointment.status === "CANCELLED") {
    return {
      view: mapPublicManageView(appointment),
      alreadyCancelled: true,
    };
  }

  const publicStatus = resolvePublicStatus(appointment);
  if (publicStatus === "completed") {
    throw new BookingManageError("Нельзя отменить прошедшую запись");
  }

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: "CANCELLED",
      cancelledAt: getStudioNow(),
      cancelledBy: "CLIENT",
      cancelReason: reason?.trim() || null,
    },
    include: {
      master: { select: { publicName: true } },
      service: { select: { publicName: true, durationMinutes: true } },
    },
  });

  return {
    view: mapPublicManageView(updated),
    alreadyCancelled: false,
  };
}

export async function requestRescheduleByManageToken(
  token: string,
  message: string,
): Promise<PublicManageAppointmentView> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new BookingManageError("Напишите, на какой день или время вам удобно");
  }

  const appointment = await findAppointmentByManageToken(token);
  if (!appointment) {
    throw new BookingManageError("Запись не найдена");
  }

  if (appointment.status === "CANCELLED") {
    throw new BookingManageError("Запись отменена, перенос недоступен");
  }

  const publicStatus = resolvePublicStatus(appointment);
  if (publicStatus === "completed") {
    throw new BookingManageError("Запись уже прошла, перенос недоступен");
  }

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      rescheduleRequestText: trimmedMessage,
      rescheduleRequestedAt: getStudioNow(),
    },
    include: {
      master: { select: { publicName: true } },
      service: { select: { publicName: true, durationMinutes: true } },
    },
  });

  return mapPublicManageView(updated);
}
