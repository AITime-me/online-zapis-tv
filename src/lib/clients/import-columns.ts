export const CLIENT_IMPORT_FIELDS = [
  "fullName",
  "phone",
  "email",
  "birthDate",
  "gender",
  "status",
  "source",
  "tags",
  "notes",
  "loyaltyLevel",
  "bonusBalance",
  "totalSpent",
  "lastVisitAt",
  "lastContactAt",
  "isArchived",
] as const;

export type ClientImportField = (typeof CLIENT_IMPORT_FIELDS)[number];

export type ClientImportColumnMapping = {
  header: string;
  field: ClientImportField | null;
  used: boolean;
};

const COLUMN_ALIASES: Record<ClientImportField, string[]> = {
  fullName: ["full_name", "fullname", "фио", "имя", "клиент", "name"],
  phone: ["phone", "телефон", "тел", "mobile", "мобильный"],
  email: ["email", "e-mail", "почта", "e_mail"],
  birthDate: ["birth_date", "birthdate", "дата рождения", "др", "birthday"],
  gender: ["gender", "пол"],
  status: ["status", "статус"],
  source: ["source", "источник"],
  tags: ["tags", "теги", "tag", "тег"],
  notes: [
    "notes",
    "note",
    "заметки",
    "заметка",
    "примечание",
    "комментарий",
    "comment",
  ],
  loyaltyLevel: [
    "loyalty_level",
    "loyaltylevel",
    "уровень лояльности",
    "лояльность",
  ],
  bonusBalance: [
    "bonus_balance",
    "bonusbalance",
    "бонусный баланс",
    "бонусы",
    "бонус",
  ],
  totalSpent: [
    "total_spent",
    "totalspent",
    "общая сумма",
    "сумма",
    "потрачено",
  ],
  lastVisitAt: ["last_visit_at", "lastvisitat", "последний визит", "визит"],
  lastContactAt: [
    "last_contact_at",
    "lastcontactat",
    "последний контакт",
    "контакт",
  ],
  isArchived: ["is_archived", "isarchived", "архив", "archived"],
};

const IGNORED_HEADERS = new Set([
  "id",
  "id клиента",
  "client id",
  "client_id",
  "нормализованный телефон",
  "normalized_phone",
  "normalizedphone",
  "количество заявок",
  "booking_request_count",
  "последняя заявка",
  "last_booking_request_at",
  "дата создания",
  "created_at",
  "createdat",
  "дата обновления",
  "updated_at",
  "updatedat",
]);

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ");
}

export function resolveClientImportField(
  header: string,
): ClientImportField | null {
  const normalized = normalizeHeader(header);
  if (!normalized || IGNORED_HEADERS.has(normalized)) {
    return null;
  }

  for (const field of CLIENT_IMPORT_FIELDS) {
    if (COLUMN_ALIASES[field].includes(normalized)) {
      return field;
    }
  }

  return null;
}

export function mapClientImportColumns(
  headers: string[],
): ClientImportColumnMapping[] {
  const usedFields = new Set<ClientImportField>();

  return headers.map((header) => {
    const field = resolveClientImportField(header);
    if (!field || usedFields.has(field)) {
      return {
        header,
        field: null,
        used: false,
      };
    }

    usedFields.add(field);
    return {
      header,
      field,
      used: true,
    };
  });
}

export function rowToImportValues(
  headers: string[],
  row: string[],
): Partial<Record<ClientImportField, string>> {
  const mapping = mapClientImportColumns(headers);
  const values: Partial<Record<ClientImportField, string>> = {};

  for (let index = 0; index < mapping.length; index += 1) {
    const column = mapping[index];
    if (!column.field) {
      continue;
    }
    values[column.field] = row[index] ?? "";
  }

  return values;
}
