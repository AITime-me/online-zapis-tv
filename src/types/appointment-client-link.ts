import type { AppointmentSource, ClientStatus } from "@prisma/client";

export type AppointmentClientCandidate = {
  id: string;
  fullName: string;
  phone: string | null;
  status: ClientStatus;
};

export type AppointmentClientLinkResult =
  | { status: "not_applicable" }
  | { status: "already_linked"; clientId: string }
  | { status: "linked"; clientId: string }
  | { status: "created"; clientId: string }
  | {
      status: "duplicate";
      candidates: AppointmentClientCandidate[];
    }
  | { status: "skipped_invalid_phone" }
  | { status: "skipped_technical_phone" }
  | { status: "error"; message: string };

/** Человекочитаемые source для Client, созданных из Appointment. */
export const APPOINTMENT_CLIENT_SOURCE_LABELS: Record<
  AppointmentSource,
  string
> = {
  ONLINE: "Онлайн-запись",
  PHONE: "Телефон",
  BOT: "Бот",
  INTERNAL: "Ручная запись",
  OTHER: "Другое",
};

export const APPOINTMENT_CLIENT_SOURCE_TAGS: Partial<
  Record<AppointmentSource, string[]>
> = {
  ONLINE: ["онлайн-запись"],
  BOT: ["бот"],
  PHONE: ["телефон"],
};
