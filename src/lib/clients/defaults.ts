import type { ClientStatus } from "@prisma/client";

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  NEW: "Новый",
  ACTIVE: "Активный",
  INACTIVE: "Неактивный",
  BLOCKED: "Заблокирован",
};

export const CLIENT_STATUSES = Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[];

export function getClientStatusLabel(status: ClientStatus): string {
  return CLIENT_STATUS_LABELS[status];
}

export const CLIENT_SEED_IDS = {
  anna: "00000000-0000-4000-8000-000000000101",
  maria: "00000000-0000-4000-8000-000000000102",
  game: "00000000-0000-4000-8000-000000000103",
  duplicatePhoneA: "00000000-0000-4000-8000-000000000104",
  duplicatePhoneB: "00000000-0000-4000-8000-000000000105",
} as const;
