import type { ClientStatus, Prisma } from "@prisma/client";
import { CLIENT_STATUSES, CLIENT_STATUS_LABELS } from "@/lib/clients/defaults";
import {
  mapClientImportColumns,
  rowToImportValues,
} from "@/lib/clients/import-columns";
import { mergeClientTags, normalizeTagValue } from "@/lib/clients/tags";
import { parseCsvContent } from "@/lib/csv/parse-csv";
import { normalizePhone } from "@/lib/phone/normalize-phone";
import { prisma } from "@/lib/db";
import type {
  ClientImportCommitResult,
  ClientImportCommitRow,
  ClientImportPreviewResult,
  ClientImportPreviewRow,
  ClientImportRowAction,
  ClientImportRowData,
  ClientImportSummary,
} from "@/types/client-import";

export const CLIENT_IMPORT_MAX_ROWS = 5000;
export const CLIENT_IMPORT_MAX_FILE_CHARS = 5_000_000;
export const CLIENT_IMPORT_PREVIEW_LIMIT = 50;

export class ClientImportValidationError extends Error {}

const clientMatchSelect = {
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
} satisfies Prisma.ClientSelect;

type ClientMatchRow = Prisma.ClientGetPayload<{
  select: typeof clientMatchSelect;
}>;

type ClientMatchIndex = {
  byPhone: Map<string, ClientMatchRow[]>;
  byEmail: Map<string, ClientMatchRow[]>;
};

type ParsedImportRow = {
  rowNumber: number;
  values: Partial<Record<string, string>>;
  data: ClientImportRowData | null;
  errors: string[];
  warnings: string[];
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseImportTags(value: string | null | undefined): string[] {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return [];
  }

  return mergeClientTags(
    [],
    normalized
      .split(/[,;|]/)
      .map((part) => normalizeTagValue(part))
      .filter(Boolean),
  );
}

function parseImportStatus(
  value: string | null | undefined,
): ClientStatus | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  const upper = normalized.toUpperCase();
  if (CLIENT_STATUSES.includes(upper as ClientStatus)) {
    return upper as ClientStatus;
  }

  const byLabel = Object.entries(CLIENT_STATUS_LABELS).find(
    ([, label]) => label.toLowerCase() === normalized.toLowerCase(),
  );
  return byLabel ? (byLabel[0] as ClientStatus) : null;
}

function parseImportArchived(value: string | null | undefined): boolean | null {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["да", "yes", "true", "1", "архив", "archived"].includes(normalized)) {
    return true;
  }
  if (["нет", "no", "false", "0", "активный", "active"].includes(normalized)) {
    return false;
  }

  return null;
}

function parseImportDate(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const date = new Date(`${normalized}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : normalized;
  }

  const dotted = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotted) {
    const day = dotted[1].padStart(2, "0");
    const month = dotted[2].padStart(2, "0");
    const iso = `${dotted[3]}-${month}-${day}`;
    const date = new Date(`${iso}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : iso;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseImportDateTime(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  const dateOnly = parseImportDate(normalized);
  if (dateOnly && !normalized.includes(":")) {
    return `${dateOnly}T00:00:00.000Z`;
  }

  const parsed = new Date(normalized.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function parseImportNumber(
  value: string | null | undefined,
  label: string,
): { value: number | null; error: string | null } {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return { value: null, error: null };
  }

  const sanitized = normalized.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      value: null,
      error: `Некорректное значение поля «${label}»`,
    };
  }

  return { value: Math.trunc(parsed), error: null };
}

function parseImportEmail(
  value: string | null | undefined,
): { value: string | null; error: string | null } {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return { value: null, error: null };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { value: null, error: "Некорректный email" };
  }

  return { value: normalized.toLowerCase(), error: null };
}

function parseImportRow(
  rowNumber: number,
  headers: string[],
  row: string[],
): ParsedImportRow {
  const values = rowToImportValues(headers, row);
  const errors: string[] = [];
  const warnings: string[] = [];

  const fullName = normalizeOptionalText(values.fullName);
  if (!fullName) {
    return {
      rowNumber,
      values,
      data: null,
      errors: ["Не указано ФИО"],
      warnings,
    };
  }

  const emailResult = parseImportEmail(values.email);
  if (emailResult.error) {
    errors.push(emailResult.error);
  }

  const bonusResult = parseImportNumber(values.bonusBalance, "Бонусный баланс");
  if (bonusResult.error) {
    errors.push(bonusResult.error);
  }

  const totalResult = parseImportNumber(values.totalSpent, "Общая сумма");
  if (totalResult.error) {
    errors.push(totalResult.error);
  }

  const statusRaw = normalizeOptionalText(values.status);
  const status = parseImportStatus(values.status);
  if (statusRaw && !status) {
    errors.push("Нераспознанный статус");
  }

  const birthDateRaw = normalizeOptionalText(values.birthDate);
  const birthDate = parseImportDate(values.birthDate);
  if (birthDateRaw && !birthDate) {
    warnings.push("Дата рождения не распознана");
  }

  const lastVisitRaw = normalizeOptionalText(values.lastVisitAt);
  const lastVisitAt = parseImportDateTime(values.lastVisitAt);
  if (lastVisitRaw && !lastVisitAt) {
    warnings.push("Последний визит не распознан");
  }

  const lastContactRaw = normalizeOptionalText(values.lastContactAt);
  const lastContactAt = parseImportDateTime(values.lastContactAt);
  if (lastContactRaw && !lastContactAt) {
    warnings.push("Последний контакт не распознан");
  }

  const phone = normalizeOptionalText(values.phone);
  const normalizedPhoneValue = normalizePhone(phone);
  const hasContacts = Boolean(phone || emailResult.value);

  if (!hasContacts) {
    warnings.push("Без контактов");
  }

  if (errors.length > 0) {
    return { rowNumber, values, data: null, errors, warnings };
  }

  return {
    rowNumber,
    values,
    data: {
      fullName,
      phone,
      normalizedPhone: normalizedPhoneValue,
      email: emailResult.value,
      birthDate,
      gender: normalizeOptionalText(values.gender),
      status,
      source: normalizeOptionalText(values.source),
      tags: parseImportTags(values.tags),
      notes: normalizeOptionalText(values.notes),
      loyaltyLevel: normalizeOptionalText(values.loyaltyLevel),
      bonusBalance: bonusResult.value,
      totalSpent: totalResult.value,
      lastVisitAt,
      lastContactAt,
      isArchived: parseImportArchived(values.isArchived),
    },
    errors,
    warnings,
  };
}

async function buildClientMatchIndex(): Promise<ClientMatchIndex> {
  const clients = await prisma.client.findMany({
    where: { isArchived: false },
    select: clientMatchSelect,
  });

  const byPhone = new Map<string, ClientMatchRow[]>();
  const byEmail = new Map<string, ClientMatchRow[]>();

  for (const client of clients) {
    if (client.normalizedPhone) {
      const list = byPhone.get(client.normalizedPhone) ?? [];
      list.push(client);
      byPhone.set(client.normalizedPhone, list);
    }

    if (client.email) {
      const key = client.email.toLowerCase();
      const list = byEmail.get(key) ?? [];
      list.push(client);
      byEmail.set(key, list);
    }
  }

  return { byPhone, byEmail };
}

function findMatchesForRow(
  data: ClientImportRowData,
  index: ClientMatchIndex,
): ClientMatchRow[] {
  if (data.normalizedPhone) {
    const byPhone = index.byPhone.get(data.normalizedPhone) ?? [];
    if (byPhone.length > 0) {
      return byPhone;
    }
  }

  if (data.email) {
    return index.byEmail.get(data.email.toLowerCase()) ?? [];
  }

  return [];
}

function buildReason(
  action: ClientImportRowAction,
  errors: string[],
  warnings: string[],
): string | null {
  if (action === "error" && errors.length > 0) {
    return errors.join("; ");
  }
  if (warnings.length > 0) {
    return warnings.join("; ");
  }
  if (action === "duplicate") {
    return "Найдено несколько клиентов с таким телефоном или email";
  }
  if (action === "skip") {
    return "Пустая строка";
  }
  return null;
}

function createEmptySummary(): ClientImportSummary {
  return {
    totalRows: 0,
    toCreate: 0,
    toUpdate: 0,
    errors: 0,
    duplicates: 0,
    skipped: 0,
    noContacts: 0,
  };
}

function incrementSummary(
  summary: ClientImportSummary,
  action: ClientImportRowAction,
  hasNoContacts: boolean,
) {
  summary.totalRows += 1;
  if (action === "create") {
    summary.toCreate += 1;
  } else if (action === "update") {
    summary.toUpdate += 1;
  } else if (action === "error") {
    summary.errors += 1;
  } else if (action === "duplicate") {
    summary.duplicates += 1;
  } else if (action === "skip") {
    summary.skipped += 1;
  }

  if (hasNoContacts && (action === "create" || action === "update")) {
    summary.noContacts += 1;
  }
}

function appendNotes(
  existing: string | null,
  incoming: string | null,
): string | null {
  if (!incoming) {
    return existing;
  }
  if (!existing?.trim()) {
    return incoming;
  }
  if (existing.includes(incoming)) {
    return existing;
  }
  return `${existing}\n\n${incoming}`;
}

function buildCreateData(data: ClientImportRowData): Prisma.ClientCreateInput {
  return {
    fullName: data.fullName,
    phone: data.phone,
    normalizedPhone: data.normalizedPhone,
    email: data.email,
    birthDate: data.birthDate ? new Date(`${data.birthDate}T00:00:00.000Z`) : null,
    gender: data.gender,
    source: data.source,
    status: data.status ?? "NEW",
    notes: data.notes,
    tags: data.tags,
    loyaltyLevel: data.loyaltyLevel,
    bonusBalance: data.bonusBalance ?? 0,
    totalSpent: data.totalSpent ?? 0,
    lastVisitAt: data.lastVisitAt ? new Date(data.lastVisitAt) : null,
    lastContactAt: data.lastContactAt ? new Date(data.lastContactAt) : null,
    isArchived: data.isArchived ?? false,
  };
}

function buildUpdateData(
  existing: ClientMatchRow,
  data: ClientImportRowData,
): Prisma.ClientUpdateInput {
  const update: Prisma.ClientUpdateInput = {};

  if (!existing.phone && data.phone) {
    update.phone = data.phone;
    update.normalizedPhone = data.normalizedPhone;
  } else if (existing.phone && !existing.normalizedPhone && data.normalizedPhone) {
    update.normalizedPhone = data.normalizedPhone;
  }

  if (!existing.email && data.email) {
    update.email = data.email;
  }

  if (!existing.birthDate && data.birthDate) {
    update.birthDate = new Date(`${data.birthDate}T00:00:00.000Z`);
  }

  if (!existing.gender && data.gender) {
    update.gender = data.gender;
  }

  if (!existing.source?.trim() && data.source) {
    update.source = data.source;
  }

  if (data.notes) {
    const mergedNotes = appendNotes(existing.notes, data.notes);
    if (mergedNotes !== existing.notes) {
      update.notes = mergedNotes;
    }
  }

  if (data.tags.length > 0) {
    update.tags = mergeClientTags(existing.tags, data.tags);
  }

  if (!existing.loyaltyLevel?.trim() && data.loyaltyLevel) {
    update.loyaltyLevel = data.loyaltyLevel;
  }

  if (
    data.bonusBalance !== null &&
    existing.bonusBalance === 0 &&
    data.bonusBalance > 0
  ) {
    update.bonusBalance = data.bonusBalance;
  }

  if (
    data.totalSpent !== null &&
    existing.totalSpent === 0 &&
    data.totalSpent > 0
  ) {
    update.totalSpent = data.totalSpent;
  }

  if (data.status) {
    update.status = data.status;
  }

  if (data.isArchived !== null) {
    update.isArchived = data.isArchived;
  }

  if (!existing.lastVisitAt && data.lastVisitAt) {
    update.lastVisitAt = new Date(data.lastVisitAt);
  }

  if (!existing.lastContactAt && data.lastContactAt) {
    update.lastContactAt = new Date(data.lastContactAt);
  }

  return update;
}

function hasUpdateChanges(update: Prisma.ClientUpdateInput): boolean {
  return Object.keys(update).length > 0;
}

export function validateImportCsvText(csvText: string): void {
  if (!csvText.trim()) {
    throw new ClientImportValidationError("Файл пустой");
  }

  if (csvText.length > CLIENT_IMPORT_MAX_FILE_CHARS) {
    throw new ClientImportValidationError(
      "Файл слишком большой для текущего импорта. Разделите базу на несколько файлов.",
    );
  }
}

export async function previewClientImport(
  csvText: string,
): Promise<ClientImportPreviewResult> {
  validateImportCsvText(csvText);

  const parsed = parseCsvContent(csvText);
  if (parsed.rows.length > CLIENT_IMPORT_MAX_ROWS) {
    throw new ClientImportValidationError(
      "Файл слишком большой для текущего импорта. Разделите базу на несколько файлов.",
    );
  }

  const columnMapping = mapClientImportColumns(parsed.headers);
  const hasFullNameColumn = columnMapping.some(
    (column) => column.field === "fullName",
  );
  if (!hasFullNameColumn) {
    throw new ClientImportValidationError(
      "Не найдена колонка с ФИО. Проверьте заголовки CSV.",
    );
  }

  const matchIndex = await buildClientMatchIndex();
  const summary = createEmptySummary();
  const previewRows: ClientImportPreviewRow[] = [];
  const commitRows: ClientImportCommitRow[] = [];
  const reservedPhones = new Set<string>();
  const reservedEmails = new Set<string>();

  for (let index = 0; index < parsed.rows.length; index += 1) {
    const rowNumber = index + 2;
    const parsedRow = parseImportRow(rowNumber, parsed.headers, parsed.rows[index]);

    if (!parsedRow.data) {
      const action: ClientImportRowAction =
        parsedRow.errors[0] === "Не указано ФИО" &&
        Object.values(parsedRow.values).every((value) => !value?.trim())
          ? "skip"
          : "error";
      const reason = buildReason(action, parsedRow.errors, parsedRow.warnings);
      incrementSummary(summary, action, false);
      if (previewRows.length < CLIENT_IMPORT_PREVIEW_LIMIT) {
        previewRows.push({
          rowNumber,
          fullName: parsedRow.values.fullName?.trim() || "—",
          phone: normalizeOptionalText(parsedRow.values.phone),
          email: normalizeOptionalText(parsedRow.values.email),
          tags: parseImportTags(parsedRow.values.tags),
          action,
          reason,
          existingClientId: null,
        });
      }
      continue;
    }

    const data = parsedRow.data;
    const hasNoContacts = !data.phone && !data.email;
    let action: ClientImportRowAction = "create";
    let existingClientId: string | null = null;
    let reason = buildReason(action, parsedRow.errors, parsedRow.warnings);

    const filePhoneKey = data.normalizedPhone ?? "";
    const fileEmailKey = data.email?.toLowerCase() ?? "";

    if (filePhoneKey && reservedPhones.has(filePhoneKey)) {
      action = "duplicate";
      reason = "Дублирующийся телефон внутри файла";
    } else if (fileEmailKey && reservedEmails.has(fileEmailKey)) {
      action = "duplicate";
      reason = "Дублирующийся email внутри файла";
    } else {
      const matches = findMatchesForRow(data, matchIndex);
      if (matches.length > 1) {
        action = "duplicate";
        reason = "Найдено несколько клиентов с таким телефоном или email";
      } else if (matches.length === 1) {
        action = "update";
        existingClientId = matches[0].id;
      }
    }

    incrementSummary(summary, action, hasNoContacts);

    if (previewRows.length < CLIENT_IMPORT_PREVIEW_LIMIT) {
      previewRows.push({
        rowNumber,
        fullName: data.fullName,
        phone: data.phone,
        email: data.email,
        tags: data.tags,
        action,
        reason,
        existingClientId,
      });
    }

    if (action === "create" || action === "update") {
      commitRows.push({
        rowNumber,
        action,
        existingClientId,
        data,
      });

      if (filePhoneKey) {
        reservedPhones.add(filePhoneKey);
      }
      if (fileEmailKey) {
        reservedEmails.add(fileEmailKey);
      }
    }
  }

  return {
    delimiter: parsed.delimiter,
    columnMapping,
    summary,
    previewRows,
    commitRows,
  };
}

export async function commitClientImport(
  rows: ClientImportCommitRow[],
): Promise<ClientImportCommitResult> {
  if (rows.length > CLIENT_IMPORT_MAX_ROWS) {
    throw new ClientImportValidationError(
      "Файл слишком большой для текущего импорта. Разделите базу на несколько файлов.",
    );
  }

  const result: ClientImportCommitResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  const matchIndex = await buildClientMatchIndex();
  const reservedPhones = new Set<string>();
  const reservedEmails = new Set<string>();

  for (const row of rows) {
    if (row.action !== "create" && row.action !== "update") {
      continue;
    }

    try {
      const filePhoneKey = row.data.normalizedPhone ?? "";
      const fileEmailKey = row.data.email?.toLowerCase() ?? "";

      if (filePhoneKey && reservedPhones.has(filePhoneKey)) {
        throw new Error("Дублирующийся телефон внутри файла");
      }
      if (fileEmailKey && reservedEmails.has(fileEmailKey)) {
        throw new Error("Дублирующийся email внутри файла");
      }

      if (row.action === "create") {
        const matches = findMatchesForRow(row.data, matchIndex);
        if (matches.length > 1) {
          throw new Error("Найдено несколько клиентов с таким телефоном или email");
        }
        if (matches.length === 1) {
          const update = buildUpdateData(matches[0], row.data);
          if (hasUpdateChanges(update)) {
            await prisma.client.update({
              where: { id: matches[0].id },
              data: update,
            });
          }
          result.updated += 1;
        } else {
          const created = await prisma.client.create({
            data: buildCreateData(row.data),
            select: clientMatchSelect,
          });
          result.created += 1;

          if (created.normalizedPhone) {
            const list = matchIndex.byPhone.get(created.normalizedPhone) ?? [];
            list.push(created);
            matchIndex.byPhone.set(created.normalizedPhone, list);
          }
          if (created.email) {
            const key = created.email.toLowerCase();
            const list = matchIndex.byEmail.get(key) ?? [];
            list.push(created);
            matchIndex.byEmail.set(key, list);
          }
        }
      } else {
        if (!row.existingClientId) {
          throw new Error("Не указан клиент для обновления");
        }

        const existing = await prisma.client.findUnique({
          where: { id: row.existingClientId },
          select: clientMatchSelect,
        });

        if (!existing) {
          throw new Error("Клиент для обновления не найден");
        }

        const rematches = findMatchesForRow(row.data, matchIndex);
        if (rematches.length > 1) {
          throw new Error("Найдено несколько клиентов с таким телефоном или email");
        }
        if (rematches.length === 1 && rematches[0].id !== existing.id) {
          throw new Error("Клиент для обновления не совпадает с найденным");
        }

        const update = buildUpdateData(existing, row.data);
        if (hasUpdateChanges(update)) {
          const updated = await prisma.client.update({
            where: { id: existing.id },
            data: update,
            select: clientMatchSelect,
          });

          if (updated.normalizedPhone) {
            matchIndex.byPhone.set(updated.normalizedPhone, [updated]);
          }
          if (updated.email) {
            matchIndex.byEmail.set(updated.email.toLowerCase(), [updated]);
          }
        }
        result.updated += 1;
      }

      if (filePhoneKey) {
        reservedPhones.add(filePhoneKey);
      }
      if (fileEmailKey) {
        reservedEmails.add(fileEmailKey);
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        rowNumber: row.rowNumber,
        error:
          error instanceof Error ? error.message : "Не удалось импортировать строку",
      });
    }
  }

  return result;
}
