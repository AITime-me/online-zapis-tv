/** Заголовок записи в расписании — только публичное название услуги. */
export function getScheduleAppointmentTitle(
  serviceName: string | null | undefined,
): string {
  const trimmed = serviceName?.trim();
  return trimmed || "Услуга";
}

export function formatSchedulePromoBadgeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return "Акция";
  }
  if (/^акция\s*:/i.test(trimmed)) {
    return trimmed;
  }
  return `Акция: ${trimmed}`;
}
