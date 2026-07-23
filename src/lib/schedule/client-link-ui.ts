import type { AppointmentClientLinkResult } from "@/types/appointment-client-link";

/** Сообщение по результату CRM-sync с учётом уже сохранённого clientId. */
export function describeClientLinkActionMessage(input: {
  clientLink: AppointmentClientLinkResult | null | undefined;
  clientId: string | null | undefined;
}): string | null {
  if (!input.clientLink) {
    return null;
  }
  switch (input.clientLink.status) {
    case "created":
      return "Клиент создан и связан с записью";
    case "linked":
    case "already_linked":
      return "Клиент связан с записью";
    case "duplicate":
      return "Найдено несколько клиентов с этим телефоном — выберите вручную";
    case "skipped_technical_phone":
    case "skipped_invalid_phone":
      return "Создание клиента пропущено: телефон непригоден";
    case "error":
      return input.clientId
        ? "Клиент связан, но данные визита не обновлены"
        : "Не удалось привязать клиента";
    default:
      return null;
  }
}

export function shouldOfferClientLinkRetry(input: {
  statusCode: string;
  clientId: string | null | undefined;
  lastClientLink: AppointmentClientLinkResult | null | undefined;
}): boolean {
  if (input.statusCode !== "COMPLETED") {
    return false;
  }
  if (!input.clientId) {
    return true;
  }
  return input.lastClientLink?.status === "error";
}

export function clientLinkRetryButtonLabel(input: {
  clientId: string | null | undefined;
  lastClientLink: AppointmentClientLinkResult | null | undefined;
}): string {
  if (input.clientId && input.lastClientLink?.status === "error") {
    return "Повторить синхронизацию";
  }
  return "Повторить привязку";
}
