import type { Client, ClientStatus, Prisma } from "@prisma/client";
import {
  getPhoneMatchSuffix,
  normalizePhone,
} from "@/lib/phone/normalize-phone";
import { mergeClientTags } from "@/lib/clients/tags";
import { normalizeClientFullName } from "@/lib/clients/normalize-full-name";
import { prisma } from "@/lib/db";

export type ClientLeadSource =
  | "online_booking"
  | "procedure_gift_game"
  | "admin_manual"
  | "unknown";

export type ClientLinkStatus =
  | "found"
  | "created"
  | "none"
  | "duplicate"
  | "name_duplicate";

export type PossibleDuplicateClient = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: ClientStatus;
  tags: string[];
  isArchived: boolean;
};

export type ResolveClientForLeadInput = {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  source: ClientLeadSource;
  tags?: string[];
  serviceName?: string | null;
};

export type ClientLinkResult = {
  clientId: string | null;
  linkStatus: ClientLinkStatus;
  isNewClient: boolean;
  duplicateNote: string | null;
  possibleDuplicateClients: PossibleDuplicateClient[];
  duplicateReason: string | null;
};

const DUPLICATE_COMMENT_PREFIX = "[CRM: возможные дубли клиентов";
const FIO_DUPLICATE_COMMENT_PREFIX = "[CRM: совпадение ФИО";
const MANAGER_DECISION_PREFIX = "[CRM:";

const SOURCE_LABELS: Record<ClientLeadSource, string> = {
  online_booking: "Онлайн-запись",
  procedure_gift_game: "Игра «Поймай своё время»",
  admin_manual: "Админка",
  unknown: "Неизвестный источник",
};

const DEFAULT_TAGS_BY_SOURCE: Partial<Record<ClientLeadSource, string[]>> = {
  online_booking: ["онлайн-запись"],
  procedure_gift_game: ["игра", "подарок"],
};

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email?.trim()) {
    return null;
  }
  return email.trim().toLowerCase();
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  return mergeClientTags(existing, incoming);
}

function buildTags(
  source: ClientLeadSource,
  extraTags: string[] | undefined,
  serviceName: string | null | undefined,
): string[] {
  const tags = [...(DEFAULT_TAGS_BY_SOURCE[source] ?? []), ...(extraTags ?? [])];

  const serviceTag = serviceName?.trim();
  if (serviceTag) {
    tags.push(serviceTag);
  }

  return mergeTags([], tags);
}

function buildDuplicateNote(clientIds: string[]): string {
  return `${DUPLICATE_COMMENT_PREFIX} — автосвязь не выполнена. ID: ${clientIds.join(", ")}]`;
}

function buildFioDuplicateNote(clientIds: string[]): string {
  return `${FIO_DUPLICATE_COMMENT_PREFIX} — требуется решение менеджера. ID: ${clientIds.join(", ")}]`;
}

export function isFioDuplicateComment(comment: string | null | undefined): boolean {
  return Boolean(comment?.includes(FIO_DUPLICATE_COMMENT_PREFIX));
}

export function hasPossibleDuplicateComment(
  comment: string | null | undefined,
): boolean {
  return isDuplicateClientComment(comment) || isFioDuplicateComment(comment);
}

export function parsePossibleDuplicateClientIds(
  comment: string | null | undefined,
): string[] {
  if (!comment) {
    return [];
  }

  const match = comment.match(/ID:\s*([^[\]]+)/);
  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function appendManagerDecisionNote(
  comment: string | null | undefined,
  note: string,
): string {
  const base = comment?.trim();
  if (!base) {
    return note;
  }
  if (base.includes(note)) {
    return base;
  }
  return `${base}\n\n${note}`;
}

export function buildManagerLinkNote(client: Pick<Client, "id" | "fullName">): string {
  return `${MANAGER_DECISION_PREFIX} менеджер связал заявку с существующим клиентом ${client.fullName} (${client.id})]`;
}

export function buildManagerCreateSeparateNote(): string {
  return `${MANAGER_DECISION_PREFIX} менеджер создал отдельного клиента несмотря на совпадение ФИО]`;
}

export function isDuplicateClientComment(comment: string | null | undefined): boolean {
  return Boolean(comment?.includes(DUPLICATE_COMMENT_PREFIX));
}

export function appendDuplicateNote(
  comment: string | null | undefined,
  duplicateNote: string,
): string {
  const base = comment?.trim();
  if (!base) {
    return duplicateNote;
  }
  if (base.includes(duplicateNote)) {
    return base;
  }
  return `${base}\n\n${duplicateNote}`;
}

async function findClientsByPhone(phone: string): Promise<Client[]> {
  const normalized = normalizePhone(phone);
  const suffix = getPhoneMatchSuffix(phone);

  if (!normalized && !suffix) {
    return [];
  }

  const conditions: Prisma.ClientWhereInput[] = [];
  if (normalized) {
    conditions.push({ normalizedPhone: normalized });
  }
  if (suffix) {
    conditions.push({ normalizedPhone: { endsWith: suffix } });
  }

  if (conditions.length === 0) {
    return [];
  }

  const matches = await prisma.client.findMany({
    where: {
      isArchived: false,
      mergedIntoClientId: null,
      OR: conditions,
    },
    orderBy: { updatedAt: "desc" },
  });

  const unique = new Map<string, Client>();
  for (const client of matches) {
    unique.set(client.id, client);
  }

  return [...unique.values()];
}

async function findClientsByEmail(email: string): Promise<Client[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return [];
  }

  return prisma.client.findMany({
    where: {
      isArchived: false,
      mergedIntoClientId: null,
      email: { equals: normalized, mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
  });
}

const FIO_CANDIDATE_LIMIT = 5;

const possibleDuplicateClientSelect = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  status: true,
  tags: true,
  isArchived: true,
} satisfies Prisma.ClientSelect;

type PossibleDuplicateClientRow = Prisma.ClientGetPayload<{
  select: typeof possibleDuplicateClientSelect;
}>;

function mapPossibleDuplicateClient(
  client: PossibleDuplicateClientRow,
): PossibleDuplicateClient {
  return {
    id: client.id,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
    status: client.status,
    tags: client.tags,
    isArchived: client.isArchived,
  };
}

export async function findClientsByNormalizedFullName(
  fullName: string,
  options?: { excludeClientIds?: string[]; limit?: number },
): Promise<PossibleDuplicateClient[]> {
  const normalized = normalizeClientFullName(fullName);
  if (!normalized) {
    return [];
  }

  const exclude = new Set(options?.excludeClientIds ?? []);
  const limit = options?.limit ?? FIO_CANDIDATE_LIMIT;

  const clients = await prisma.client.findMany({
    select: possibleDuplicateClientSelect,
    where: { mergedIntoClientId: null },
    orderBy: [{ isArchived: "asc" }, { updatedAt: "desc" }],
  });

  return clients
    .filter((client) => normalizeClientFullName(client.fullName) === normalized)
    .filter((client) => !exclude.has(client.id))
    .slice(0, limit)
    .map(mapPossibleDuplicateClient);
}

async function findMatchingClients(
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<Client[]> {
  const byPhone = phone?.trim() ? await findClientsByPhone(phone) : [];
  const byEmail = email?.trim() ? await findClientsByEmail(email) : [];

  const unique = new Map<string, Client>();
  for (const client of [...byPhone, ...byEmail]) {
    unique.set(client.id, client);
  }

  return [...unique.values()];
}

export async function findExactClientsByContact(
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<Client[]> {
  return findMatchingClients(phone, email);
}

export async function enrichExistingClient(
  client: Client,
  input: ResolveClientForLeadInput,
): Promise<Client> {
  const now = new Date();
  const incomingPhone = input.phone?.trim() || null;
  const incomingEmail = normalizeEmail(input.email);
  const incomingTags = buildTags(input.source, input.tags, input.serviceName);

  const data: Prisma.ClientUpdateInput = {
    lastContactAt: now,
  };

  if (!client.phone && incomingPhone) {
    data.phone = incomingPhone;
    data.normalizedPhone = normalizePhone(incomingPhone);
  } else if (client.phone && !client.normalizedPhone && incomingPhone) {
    data.normalizedPhone = normalizePhone(client.phone);
  }

  if (!client.email && incomingEmail) {
    data.email = incomingEmail;
  }

  if (!client.source?.trim()) {
    data.source = SOURCE_LABELS[input.source];
  }

  if (incomingTags.length > 0) {
    data.tags = mergeTags(client.tags, incomingTags);
  }

  if (client.status === "NEW" && input.source !== "unknown") {
    data.status = "ACTIVE";
  }

  return prisma.client.update({
    where: { id: client.id },
    data,
  });
}

export async function createClientFromLead(
  input: ResolveClientForLeadInput,
): Promise<Client> {
  const phone = input.phone?.trim() || null;
  const email = normalizeEmail(input.email);
  const now = new Date();

  return prisma.client.create({
    data: {
      fullName: input.fullName.trim(),
      phone,
      normalizedPhone: normalizePhone(phone),
      email,
      source: SOURCE_LABELS[input.source],
      status: "NEW",
      tags: buildTags(input.source, input.tags, input.serviceName),
      lastContactAt: now,
    },
  });
}

export async function resolveClientForLead(
  input: ResolveClientForLeadInput,
): Promise<ClientLinkResult> {
  const emptyResult = {
    possibleDuplicateClients: [] as PossibleDuplicateClient[],
    duplicateReason: null,
  };

  const fullName = input.fullName.trim();
  if (!fullName) {
    return {
      clientId: null,
      linkStatus: "none",
      isNewClient: false,
      duplicateNote: null,
      ...emptyResult,
    };
  }

  const phone = input.phone?.trim() || null;
  const email = normalizeEmail(input.email);

  if (!phone && !email) {
    return {
      clientId: null,
      linkStatus: "none",
      isNewClient: false,
      duplicateNote: null,
      ...emptyResult,
    };
  }

  const matches = await findMatchingClients(phone, email);

  if (matches.length > 1) {
    const possibleDuplicateClients = matches.map((client) => ({
      id: client.id,
      fullName: client.fullName,
      phone: client.phone,
      email: client.email,
      status: client.status,
      tags: client.tags,
      isArchived: client.isArchived,
    }));

    return {
      clientId: null,
      linkStatus: "duplicate",
      isNewClient: false,
      duplicateNote: buildDuplicateNote(matches.map((client) => client.id)),
      possibleDuplicateClients,
      duplicateReason:
        "Найдено несколько клиентов с таким телефоном или email",
    };
  }

  if (matches.length === 1) {
    const updated = await enrichExistingClient(matches[0], input);
    return {
      clientId: updated.id,
      linkStatus: "found",
      isNewClient: false,
      duplicateNote: null,
      ...emptyResult,
    };
  }

  const nameMatches = await findClientsByNormalizedFullName(fullName);
  if (nameMatches.length > 0) {
    return {
      clientId: null,
      linkStatus: "name_duplicate",
      isNewClient: false,
      duplicateNote: buildFioDuplicateNote(nameMatches.map((client) => client.id)),
      possibleDuplicateClients: nameMatches,
      duplicateReason: "Совпадает ФИО, но телефон/email другой",
    };
  }

  return {
    clientId: null,
    linkStatus: "none",
    isNewClient: false,
    duplicateNote: null,
    ...emptyResult,
  };
}

export async function backfillClientNormalizedPhones(): Promise<void> {
  const clients = await prisma.client.findMany({
    where: {
      phone: { not: null },
      OR: [{ normalizedPhone: null }, { normalizedPhone: "" }],
    },
    select: { id: true, phone: true },
  });

  for (const client of clients) {
    await prisma.client.update({
      where: { id: client.id },
      data: { normalizedPhone: normalizePhone(client.phone) },
    });
  }
}
