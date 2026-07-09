import { prisma } from "@/lib/db";
import { CLIENT_STATUSES } from "@/lib/clients/defaults";
import { mergeClientTags, normalizeTagValue } from "@/lib/clients/tags";
import { normalizePhone } from "@/lib/phone/normalize-phone";
import { getActiveDuplicateClientIdSet } from "@/services/ClientDuplicateService";
import type {
  ClientAdminCreateInput,
  ClientAdminDto,
  ClientAdminUpdateInput,
} from "@/types/client-admin";
import type { Client, ClientStatus, Prisma } from "@prisma/client";

export class ClientAdminValidationError extends Error {}

const clientSelect = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  birthDate: true,
  gender: true,
  source: true,
  status: true,
  notes: true,
  tags: true,
  isArchived: true,
  loyaltyLevel: true,
  bonusBalance: true,
  totalSpent: true,
  lastVisitAt: true,
  lastContactAt: true,
  mergedIntoClientId: true,
  createdAt: true,
  updatedAt: true,
  mergedIntoClient: {
    select: {
      id: true,
      fullName: true,
    },
  },
} satisfies Prisma.ClientSelect;

const clientListSelect = {
  ...clientSelect,
  _count: {
    select: { bookingRequests: true },
  },
  bookingRequests: {
    select: { createdAt: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.ClientSelect;

type ClientRow = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;
type ClientListRow = Prisma.ClientGetPayload<{ select: typeof clientListSelect }>;

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ClientAdminValidationError(`${label} не может быть пустым`);
  }
  return trimmed;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateEmail(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ClientAdminValidationError("Укажите корректный email");
  }
  return normalized.toLowerCase();
}

function validateStatus(status: ClientStatus): ClientStatus {
  if (!CLIENT_STATUSES.includes(status)) {
    throw new ClientAdminValidationError("Недопустимый статус клиента");
  }
  return status;
}

function validateNonNegativeInt(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ClientAdminValidationError(`${label} не может быть отрицательным`);
  }
  return Math.trunc(value);
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new ClientAdminValidationError("Укажите корректную дату");
  }
  return date;
}

function parseOptionalDateTime(value: string | null | undefined): Date | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new ClientAdminValidationError("Укажите корректную дату и время");
  }
  return date;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }
  return mergeClientTags([], tags.map(normalizeTagValue));
}

function mapClient(row: ClientRow, hasActiveDuplicate = false): ClientAdminDto {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    gender: row.gender,
    source: row.source,
    status: row.status,
    notes: row.notes,
    tags: row.tags,
    isArchived: row.isArchived,
    loyaltyLevel: row.loyaltyLevel,
    bonusBalance: row.bonusBalance,
    totalSpent: row.totalSpent,
    lastVisitAt: row.lastVisitAt?.toISOString() ?? null,
    lastContactAt: row.lastContactAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    bookingRequestCount: 0,
    lastBookingRequestAt: null,
    hasActiveDuplicate,
    mergedIntoClientId: row.mergedIntoClientId,
    mergedIntoClientName: row.mergedIntoClient?.fullName ?? null,
  };
}

function mapClientListRow(
  row: ClientListRow,
  hasActiveDuplicate = false,
): ClientAdminDto {
  return {
    ...mapClient(row, hasActiveDuplicate),
    bookingRequestCount: row._count.bookingRequests,
    lastBookingRequestAt:
      row.bookingRequests[0]?.createdAt.toISOString() ?? null,
  };
}

function buildUpdateData(input: ClientAdminUpdateInput): Prisma.ClientUpdateInput {
  const data: Prisma.ClientUpdateInput = {};

  if (input.fullName !== undefined) {
    data.fullName = requireNonEmpty(input.fullName, "ФИО");
  }
  if (input.phone !== undefined) {
    const phone = normalizeOptionalText(input.phone);
    data.phone = phone;
    data.normalizedPhone = normalizePhone(phone);
  }
  if (input.email !== undefined) {
    data.email = validateEmail(input.email);
  }
  if (input.birthDate !== undefined) {
    data.birthDate = parseOptionalDate(input.birthDate);
  }
  if (input.gender !== undefined) {
    data.gender = normalizeOptionalText(input.gender);
  }
  if (input.source !== undefined) {
    data.source = normalizeOptionalText(input.source);
  }
  if (input.status !== undefined) {
    data.status = validateStatus(input.status);
  }
  if (input.notes !== undefined) {
    data.notes = normalizeOptionalText(input.notes);
  }
  if (input.tags !== undefined) {
    data.tags = normalizeTags(input.tags);
  }
  if (input.isArchived !== undefined) {
    data.isArchived = input.isArchived;
  }
  if (input.loyaltyLevel !== undefined) {
    data.loyaltyLevel = normalizeOptionalText(input.loyaltyLevel);
  }
  if (input.bonusBalance !== undefined) {
    data.bonusBalance = validateNonNegativeInt(input.bonusBalance, "Бонусный баланс");
  }
  if (input.totalSpent !== undefined) {
    data.totalSpent = validateNonNegativeInt(input.totalSpent, "Сумма покупок");
  }
  if (input.lastVisitAt !== undefined) {
    data.lastVisitAt = parseOptionalDateTime(input.lastVisitAt);
  }
  if (input.lastContactAt !== undefined) {
    data.lastContactAt = parseOptionalDateTime(input.lastContactAt);
  }

  return data;
}

export async function listClientsForAdmin(): Promise<ClientAdminDto[]> {
  const [rows, activeDuplicateIds] = await Promise.all([
    prisma.client.findMany({
      select: clientListSelect,
      orderBy: [{ isArchived: "asc" }, { updatedAt: "desc" }],
    }),
    getActiveDuplicateClientIdSet(),
  ]);

  return rows.map((row) =>
    mapClientListRow(row, activeDuplicateIds.has(row.id)),
  );
}

export async function getClientForAdmin(id: string): Promise<ClientAdminDto | null> {
  const [row, activeDuplicateIds] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      select: clientListSelect,
    }),
    getActiveDuplicateClientIdSet(),
  ]);
  return row ? mapClientListRow(row, activeDuplicateIds.has(row.id)) : null;
}

export async function createClientForAdmin(
  input: ClientAdminCreateInput,
): Promise<ClientAdminDto> {
  const phone = normalizeOptionalText(input.phone);
  const created = await prisma.client.create({
    data: {
      fullName: requireNonEmpty(input.fullName, "ФИО"),
      phone,
      normalizedPhone: normalizePhone(phone),
      email: validateEmail(input.email),
      birthDate: parseOptionalDate(input.birthDate),
      gender: normalizeOptionalText(input.gender),
      source: normalizeOptionalText(input.source),
      status: validateStatus(input.status ?? "NEW"),
      notes: normalizeOptionalText(input.notes),
      tags: normalizeTags(input.tags),
      loyaltyLevel: normalizeOptionalText(input.loyaltyLevel),
      bonusBalance: validateNonNegativeInt(input.bonusBalance ?? 0, "Бонусный баланс"),
      totalSpent: validateNonNegativeInt(input.totalSpent ?? 0, "Сумма покупок"),
      lastVisitAt: parseOptionalDateTime(input.lastVisitAt),
      lastContactAt: parseOptionalDateTime(input.lastContactAt),
    },
    select: clientSelect,
  });

  const activeDuplicateIds = await getActiveDuplicateClientIdSet();
  return mapClient(created, activeDuplicateIds.has(created.id));
}

export async function updateClientForAdmin(
  id: string,
  input: ClientAdminUpdateInput,
): Promise<ClientAdminDto> {
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) {
    throw new ClientAdminValidationError("Клиент не найден");
  }
  if (existing.mergedIntoClientId) {
    throw new ClientAdminValidationError(
      "Объединённый клиент нельзя редактировать",
    );
  }

  const data = buildUpdateData(input);
  const [updated, activeDuplicateIds] = await Promise.all([
    prisma.client.update({
      where: { id },
      data,
      select: clientListSelect,
    }),
    getActiveDuplicateClientIdSet(),
  ]);

  return mapClientListRow(updated, activeDuplicateIds.has(updated.id));
}

export async function archiveClientForAdmin(id: string): Promise<ClientAdminDto> {
  return updateClientForAdmin(id, { isArchived: true });
}

export async function restoreClientForAdmin(id: string): Promise<ClientAdminDto> {
  return updateClientForAdmin(id, { isArchived: false });
}

export type { Client };
