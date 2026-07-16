/**
 * Маппинг колонок выгрузки SaleBot → внутренние поля.
 * Реальные выгрузки в репозиторий не добавляются.
 */

export const SALEBOT_COLUMN_ALIASES: Record<string, string[]> = {
  id: ["ID", "id", "Id"],
  name: ["Имя", "Name", "name", "display_name"],
  messenger: ["Мессенджер", "Messenger", "messenger"],
  bot: ["С каким ботом было общение", "bot", "Bot"],
  channelUserId: [
    "Идентификатор внутри мессенджера",
    "channel_user_id",
    "peer_id",
    "vk_id",
    "VK ID",
  ],
  firstInteractionAt: [
    "Дата первого сообщения",
    "first_message_at",
    "firstInteractionAt",
  ],
  lastInteractionAt: [
    "Дата последнего сообщения",
    "last_message_at",
    "lastInteractionAt",
  ],
  lastInboundAt: [
    "Дата последнего входящего",
    "last_inbound_at",
    "lastInboundAt",
  ],
  messageId: ["message_id", "Message ID"],
  clientBlocked: ["clientBlocked", "client_blocked", "blocked"],
  notSubscribed: ["notSubscribed", "not_subscribed", "unsubscribed"],
  email: ["Email", "email", "E-mail"],
  phone: ["Phone", "phone", "Телефон"],
};

export function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim();
}

export function mapSalebotHeaders(
  headers: string[],
): Record<string, number | undefined> {
  const normalized = headers.map(normalizeHeader);
  const result: Record<string, number | undefined> = {};

  for (const [field, aliases] of Object.entries(SALEBOT_COLUMN_ALIASES)) {
    const index = normalized.findIndex((header) =>
      aliases.some((alias) => alias.toLowerCase() === header.toLowerCase()),
    );
    result[field] = index >= 0 ? index : undefined;
  }

  return result;
}

export function isVkMessenger(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "vk" ||
    normalized === "вк" ||
    normalized.includes("vkontakte") ||
    normalized.includes("вконтакте")
  );
}

export function parseTruthyFlag(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "да", "y"].includes(normalized);
}

/** VK user id: только цифры, разумная длина. */
export function normalizeVkUserId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{3,20}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function parseOptionalDateTime(
  value: string | null | undefined,
): Date | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
