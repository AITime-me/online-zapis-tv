import { parseStudioDateTime } from "@/lib/datetime/date-key";
import { bookingStudio } from "@/components/booking/booking-config";

export type BookingCalendarEvent = {
  dateKey: string;
  startTime: string;
  durationMinutes: number;
  masterName: string;
  serviceName: string;
};

function formatIcsLocalDateTime(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${pick("year")}${pick("month")}${pick("day")}T${pick("hour")}${pick("minute")}00`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function buildBookingIcsContent(event: BookingCalendarEvent): string {
  const startsAt = parseStudioDateTime(event.dateKey, event.startTime);
  const endsAt = new Date(startsAt.getTime() + event.durationMinutes * 60_000);
  const now = new Date();
  const uid = `${event.dateKey}-${event.startTime.replace(":", "")}-${Math.random().toString(36).slice(2, 10)}@tvoe-vremya`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tvoe Vremya//Booking//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsLocalDateTime(now)}`,
    `DTSTART;TZID=Asia/Yekaterinburg:${formatIcsLocalDateTime(startsAt)}`,
    `DTEND;TZID=Asia/Yekaterinburg:${formatIcsLocalDateTime(endsAt)}`,
    `SUMMARY:${escapeIcsText(`${event.serviceName} — ${bookingStudio.name}`)}`,
    `DESCRIPTION:${escapeIcsText(`Мастер: ${event.masterName}`)}`,
    `LOCATION:${escapeIcsText(bookingStudio.address)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.join("\r\n")}\r\n`;
}

export function downloadBookingIcs(event: BookingCalendarEvent): void {
  const content = buildBookingIcsContent(event);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tvoe-vremya-${event.dateKey}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}
