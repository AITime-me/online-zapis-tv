import type { ClientStatus, Prisma } from "@prisma/client";
import { buildCsvContent } from "@/lib/csv/format-csv";
import { CLIENT_STATUSES } from "@/lib/clients/defaults";
import { clientMatchesTagSearch } from "@/lib/clients/tags";
import { prisma } from "@/lib/db";

export type ClientArchiveFilter = "active" | "archived" | "all";

export type ClientExportFilters = {
  q?: string;
  status?: ClientStatus | "all";
  archived?: ClientArchiveFilter;
};

const clientExportSelect = {
  id: true,
  fullName: true,
  phone: true,
  normalizedPhone: true,
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
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { bookingRequests: true },
  },
  bookingRequests: {
    select: { createdAt: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.ClientSelect;

type ClientExportRow = Prisma.ClientGetPayload<{
  select: typeof clientExportSelect;
}>;

const CSV_HEADERS = [
  "ID клиента",
  "ФИО",
  "Телефон",
  "Нормализованный телефон",
  "Email",
  "Дата рождения",
  "Пол",
  "Статус",
  "Источник",
  "Теги",
  "Заметки",
  "Архив",
  "Уровень лояльности",
  "Бонусный баланс",
  "Общая сумма",
  "Последний визит",
  "Последний контакт",
  "Количество заявок",
  "Последняя заявка",
  "Дата создания",
  "Дата обновления",
] as const;

function formatExportDate(value: Date | null | undefined): string {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function formatExportDateTime(value: Date | null | undefined): string {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function parseArchiveFilter(value: string | null | undefined): ClientArchiveFilter {
  if (value === "archived" || value === "all") {
    return value;
  }
  return "active";
}

function parseStatusFilter(
  value: string | null | undefined,
): ClientStatus | "all" {
  if (value && CLIENT_STATUSES.includes(value as ClientStatus)) {
    return value as ClientStatus;
  }
  return "all";
}

function matchesSearchQuery(client: ClientExportRow, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [client.fullName, client.phone ?? "", client.email ?? ""]
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes(normalizedQuery) ||
    clientMatchesTagSearch(client.tags, normalizedQuery)
  );
}

function mapClientToCsvRow(client: ClientExportRow): string[] {
  return [
    client.id,
    client.fullName,
    client.phone ?? "",
    client.normalizedPhone ?? "",
    client.email ?? "",
    formatExportDate(client.birthDate),
    client.gender ?? "",
    client.status,
    client.source ?? "",
    client.tags.join(", "),
    client.notes ?? "",
    client.isArchived ? "да" : "нет",
    client.loyaltyLevel ?? "",
    String(client.bonusBalance),
    String(client.totalSpent),
    formatExportDateTime(client.lastVisitAt),
    formatExportDateTime(client.lastContactAt),
    String(client._count.bookingRequests),
    formatExportDateTime(client.bookingRequests[0]?.createdAt ?? null),
    formatExportDateTime(client.createdAt),
    formatExportDateTime(client.updatedAt),
  ];
}

export function parseClientExportFilters(
  searchParams: URLSearchParams,
): ClientExportFilters {
  return {
    q: searchParams.get("q")?.trim() || undefined,
    status: parseStatusFilter(searchParams.get("status")),
    archived: parseArchiveFilter(searchParams.get("archived")),
  };
}

export async function listClientsForExport(
  filters: ClientExportFilters,
): Promise<ClientExportRow[]> {
  const where: Prisma.ClientWhereInput = {};

  if (filters.archived === "active") {
    where.isArchived = false;
  } else if (filters.archived === "archived") {
    where.isArchived = true;
  }

  if (filters.status && filters.status !== "all") {
    where.status = filters.status;
  }

  const rows = await prisma.client.findMany({
    where,
    select: clientExportSelect,
    orderBy: [{ isArchived: "asc" }, { updatedAt: "desc" }],
  });

  if (!filters.q) {
    return rows;
  }

  return rows.filter((client) => matchesSearchQuery(client, filters.q!));
}

export function buildClientsExportCsv(clients: ClientExportRow[]): string {
  const rows = clients.map(mapClientToCsvRow);
  return buildCsvContent([...CSV_HEADERS], rows);
}

export function buildClientsExportFilename(date = new Date()): string {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  return `tvoe-vremya-clients-${dateKey}.csv`;
}
