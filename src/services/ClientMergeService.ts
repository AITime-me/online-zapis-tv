import type { ClientStatus, Prisma } from "@prisma/client";
import { mergeClientTags } from "@/lib/clients/tags";
import { normalizePhone } from "@/lib/phone/normalize-phone";
import { prisma } from "@/lib/db";
import { buildDuplicateFingerprint } from "@/services/ClientDuplicateService";
import type {
  ClientMergePreviewClient,
  ClientMergePreviewCounts,
  ClientMergePreviewResult,
  ClientMergePreviewWarning,
} from "@/types/client-merge";

export class ClientMergeValidationError extends Error {}

const mergeClientSelect = {
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
  mergedIntoClientId: true,
  _count: {
    select: {
      bookingRequests: true,
      appointments: true,
    },
  },
} satisfies Prisma.ClientSelect;

type MergeClientRow = Prisma.ClientGetPayload<{
  select: typeof mergeClientSelect;
}>;

const STATUS_PRIORITY: Record<ClientStatus, number> = {
  ACTIVE: 4,
  NEW: 3,
  INACTIVE: 2,
  BLOCKED: 1,
};

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function mapPreviewClient(client: MergeClientRow): ClientMergePreviewClient {
  return {
    id: client.id,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
    status: client.status,
    isArchived: client.isArchived,
    mergedIntoClientId: client.mergedIntoClientId,
    bookingRequestCount: client._count.bookingRequests,
    appointmentCount: client._count.appointments,
    tags: client.tags,
    notes: client.notes,
    bonusBalance: client.bonusBalance,
    totalSpent: client.totalSpent,
    lastContactAt: client.lastContactAt?.toISOString() ?? null,
    createdAt: client.createdAt.toISOString(),
  };
}

function serializeClientSnapshot(client: MergeClientRow) {
  return {
    id: client.id,
    fullName: client.fullName,
    phone: client.phone,
    normalizedPhone: client.normalizedPhone,
    email: client.email,
    status: client.status,
    tags: client.tags,
    notes: client.notes,
    bonusBalance: client.bonusBalance,
    totalSpent: client.totalSpent,
    isArchived: client.isArchived,
    mergedIntoClientId: client.mergedIntoClientId,
    bookingRequestCount: client._count.bookingRequests,
    appointmentCount: client._count.appointments,
  };
}

function recommendTargetClientId(clients: MergeClientRow[]): string {
  const sorted = [...clients].sort((left, right) => {
    const bookingDiff =
      right._count.bookingRequests - left._count.bookingRequests;
    if (bookingDiff !== 0) {
      return bookingDiff;
    }

    const leftContact = left.lastContactAt?.getTime() ?? 0;
    const rightContact = right.lastContactAt?.getTime() ?? 0;
    if (rightContact !== leftContact) {
      return rightContact - leftContact;
    }

    const statusDiff = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const leftContacts = Number(Boolean(left.phone)) + Number(Boolean(left.email));
    const rightContacts = Number(Boolean(right.phone)) + Number(Boolean(right.email));
    if (rightContacts !== leftContacts) {
      return rightContacts - leftContacts;
    }

    return left.createdAt.getTime() - right.createdAt.getTime();
  });

  return sorted[0]?.id ?? clients[0].id;
}

function buildWarnings(clients: MergeClientRow[]): ClientMergePreviewWarning[] {
  const warnings = new Set<ClientMergePreviewWarning>();

  if (clients.some((client) => client.isArchived)) {
    warnings.add("ARCHIVED_CLIENTS");
  }
  if (clients.some((client) => client.mergedIntoClientId)) {
    warnings.add("ALREADY_MERGED");
  }

  const phones = new Set(
    clients.map((client) => client.normalizedPhone ?? client.phone ?? "").filter(Boolean),
  );
  if (phones.size > 1) {
    warnings.add("DIFFERENT_PHONES");
  }

  const emails = new Set(
    clients.map((client) => client.email?.trim().toLowerCase() ?? "").filter(Boolean),
  );
  if (emails.size > 1) {
    warnings.add("DIFFERENT_EMAILS");
  }

  const names = new Set(
    clients.map((client) => client.fullName.trim().toLowerCase()).filter(Boolean),
  );
  if (names.size > 1) {
    warnings.add("DIFFERENT_NAMES");
  }

  if (clients.reduce((sum, client) => sum + client.bonusBalance, 0) > 0) {
    warnings.add("BONUS_WILL_SUM");
  }
  if (clients.reduce((sum, client) => sum + client.totalSpent, 0) > 0) {
    warnings.add("TOTAL_SPENT_WILL_SUM");
  }

  return [...warnings];
}

function buildCounts(
  target: MergeClientRow,
  sources: MergeClientRow[],
): ClientMergePreviewCounts {
  const bookingRequestsToMove = sources.reduce(
    (sum, client) => sum + client._count.bookingRequests,
    0,
  );
  const appointmentsToMove = sources.reduce(
    (sum, client) => sum + client._count.appointments,
    0,
  );
  const mergedTags = mergeClientTags(
    target.tags,
    sources.flatMap((client) => client.tags),
  );

  const notesToAppend = sources.filter((client) => client.notes?.trim()).length;

  return {
    bookingRequestsToMove,
    appointmentsToMove,
    tagsToMerge: mergedTags.length,
    notesToAppend,
    bonusBalanceTotal:
      target.bonusBalance +
      sources.reduce((sum, client) => sum + client.bonusBalance, 0),
    totalSpentTotal:
      target.totalSpent +
      sources.reduce((sum, client) => sum + client.totalSpent, 0),
  };
}

function buildNotesPreview(target: MergeClientRow, sources: MergeClientRow[]): string | null {
  const parts = [target.notes?.trim() || ""];
  for (const source of sources) {
    if (!source.notes?.trim()) {
      continue;
    }
    parts.push(source.notes.trim());
    parts.push(
      `[Объединено из клиента: ${source.fullName}${source.phone ? `, ${source.phone}` : ""}, ${source.createdAt.toISOString().slice(0, 10)}]`,
    );
  }
  const combined = parts.filter(Boolean).join("\n\n").trim();
  return combined || null;
}

async function loadMergeClients(clientIds: string[]): Promise<MergeClientRow[]> {
  const ids = uniqueIds(clientIds);
  if (ids.length < 2) {
    throw new ClientMergeValidationError(
      "Для объединения нужно выбрать минимум двух клиентов",
    );
  }

  const clients = await prisma.client.findMany({
    where: { id: { in: ids } },
    select: mergeClientSelect,
  });

  if (clients.length !== ids.length) {
    throw new ClientMergeValidationError("Не все клиенты найдены");
  }

  return clients;
}

export async function previewClientMerge(
  clientIds: string[],
  targetClientId?: string,
): Promise<ClientMergePreviewResult> {
  const clients = await loadMergeClients(clientIds);
  const recommendedTargetClientId = recommendTargetClientId(clients);
  const targetId = targetClientId?.trim() || recommendedTargetClientId;
  const target = clients.find((client) => client.id === targetId);
  if (!target) {
    throw new ClientMergeValidationError("Главный клиент не найден в группе");
  }
  const sources = clients.filter((client) => client.id !== target.id);
  const mergedTagsPreview = mergeClientTags(
    target.tags,
    sources.flatMap((client) => client.tags),
  );

  return {
    clients: clients.map(mapPreviewClient),
    recommendedTargetClientId,
    counts: buildCounts(target, sources),
    warnings: buildWarnings(clients),
    mergedTagsPreview,
    notesPreview: buildNotesPreview(target, sources),
  };
}

function maxDate(
  left: Date | null | undefined,
  right: Date | null | undefined,
): Date | null {
  if (!left) return right ?? null;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

function appendSourceNotes(
  targetNotes: string | null,
  sources: MergeClientRow[],
): string | null {
  let result = targetNotes?.trim() || "";
  for (const source of sources) {
    if (!source.notes?.trim()) {
      continue;
    }
    const block = `${source.notes.trim()}\n[Объединено из клиента: ${source.fullName}${source.phone ? `, ${source.phone}` : ""}, ${source.createdAt.toISOString().slice(0, 10)}]`;
    result = result ? `${result}\n\n${block}` : block;
  }
  return result || null;
}

function fillEmptyTargetField<T>(targetValue: T | null | undefined, sourceValue: T | null | undefined): T | null | undefined {
  if (targetValue !== null && targetValue !== undefined) {
    if (typeof targetValue === "string" && targetValue.trim()) {
      return targetValue;
    }
    if (typeof targetValue !== "string") {
      return targetValue;
    }
  }
  return sourceValue ?? targetValue;
}

export async function commitClientMerge(input: {
  targetClientId: string;
  sourceClientIds: string[];
  mergedByUserId: string;
  reason?: string | null;
}): Promise<{ mergeLogId: string; targetClientId: string; sourceClientIds: string[] }> {
  const targetClientId = input.targetClientId.trim();
  const sourceClientIds = uniqueIds(input.sourceClientIds).filter(
    (id) => id !== targetClientId,
  );

  if (!targetClientId) {
    throw new ClientMergeValidationError("Не указан главный клиент");
  }
  if (sourceClientIds.length === 0) {
    throw new ClientMergeValidationError("Не указаны клиенты для объединения");
  }

  const allIds = [targetClientId, ...sourceClientIds];
  const clients = await loadMergeClients(allIds);
  const target = clients.find((client) => client.id === targetClientId);
  if (!target) {
    throw new ClientMergeValidationError("Главный клиент не найден");
  }
  if (target.mergedIntoClientId) {
    throw new ClientMergeValidationError(
      "Главный клиент уже объединён в другого и не может быть целью",
    );
  }

  const sources = clients.filter((client) => sourceClientIds.includes(client.id));
  if (sources.length !== sourceClientIds.length) {
    throw new ClientMergeValidationError("Не все исходные клиенты найдены");
  }
  if (sources.some((client) => client.mergedIntoClientId)) {
    throw new ClientMergeValidationError(
      "Один или несколько клиентов уже объединены в другого",
    );
  }

  const movedBookingRequestIds: string[] = [];
  const movedAppointmentIds: string[] = [];
  const mergedTags = mergeClientTags(
    target.tags,
    sources.flatMap((client) => client.tags),
  );
  const notesAppended = appendSourceNotes(target.notes, sources);
  const bonusRule = "sum";
  const totalSpentRule = "sum";
  const mergedBonusBalance =
    target.bonusBalance +
    sources.reduce((sum, client) => sum + client.bonusBalance, 0);
  const mergedTotalSpent =
    target.totalSpent +
    sources.reduce((sum, client) => sum + client.totalSpent, 0);

  let nextPhone = target.phone;
  let nextNormalizedPhone = target.normalizedPhone;
  let nextEmail = target.email;
  let nextBirthDate = target.birthDate;
  let nextGender = target.gender;
  let nextSource = target.source;
  let nextLoyaltyLevel = target.loyaltyLevel;
  let nextLastVisitAt = target.lastVisitAt;
  let nextLastContactAt = target.lastContactAt;

  for (const source of sources) {
    nextPhone = fillEmptyTargetField(nextPhone, source.phone) ?? null;
    nextNormalizedPhone =
      fillEmptyTargetField(nextNormalizedPhone, source.normalizedPhone) ??
      normalizePhone(nextPhone);
    nextEmail = fillEmptyTargetField(nextEmail, source.email) ?? null;
    nextBirthDate = fillEmptyTargetField(nextBirthDate, source.birthDate) ?? null;
    nextGender = fillEmptyTargetField(nextGender, source.gender) ?? null;
    nextSource = fillEmptyTargetField(nextSource, source.source) ?? null;
    nextLoyaltyLevel =
      fillEmptyTargetField(nextLoyaltyLevel, source.loyaltyLevel) ?? null;
    nextLastVisitAt = maxDate(nextLastVisitAt, source.lastVisitAt);
    nextLastContactAt = maxDate(nextLastContactAt, source.lastContactAt);
  }

  const mergeNote =
    input.reason?.trim() ||
    `Объединено ${sources.length} клиент(ов) в ${target.fullName}`;
  const fingerprint = buildDuplicateFingerprint(allIds);
  const now = new Date();

  const mergeLogId = await prisma.$transaction(async (tx) => {
    const bookingRequests = await tx.bookingRequest.findMany({
      where: { clientId: { in: sourceClientIds } },
      select: { id: true },
    });
    movedBookingRequestIds.push(...bookingRequests.map((row) => row.id));

    const appointments = await tx.appointment.findMany({
      where: { clientId: { in: sourceClientIds } },
      select: { id: true },
    });
    movedAppointmentIds.push(...appointments.map((row) => row.id));

    if (movedBookingRequestIds.length > 0) {
      await tx.bookingRequest.updateMany({
        where: { id: { in: movedBookingRequestIds } },
        data: { clientId: targetClientId },
      });
    }

    if (movedAppointmentIds.length > 0) {
      await tx.appointment.updateMany({
        where: { id: { in: movedAppointmentIds } },
        data: { clientId: targetClientId },
      });
    }

    await tx.client.update({
      where: { id: targetClientId },
      data: {
        phone: nextPhone,
        normalizedPhone: nextNormalizedPhone,
        email: nextEmail,
        birthDate: nextBirthDate,
        gender: nextGender,
        source: nextSource,
        loyaltyLevel: nextLoyaltyLevel,
        lastVisitAt: nextLastVisitAt,
        lastContactAt: nextLastContactAt,
        tags: mergedTags,
        notes: notesAppended,
        bonusBalance: mergedBonusBalance,
        totalSpent: mergedTotalSpent,
      },
    });

    await tx.client.updateMany({
      where: { id: { in: sourceClientIds } },
      data: {
        mergedIntoClientId: targetClientId,
        mergedAt: now,
        mergedByUserId: input.mergedByUserId,
        mergeNote,
        isArchived: true,
      },
    });

    const log = await tx.clientMergeLog.create({
      data: {
        targetClientId,
        sourceClientIds,
        mergedByUserId: input.mergedByUserId,
        reason: input.reason?.trim() || null,
        snapshot: {
          targetClientBefore: serializeClientSnapshot(target),
          sourcesBefore: sources.map(serializeClientSnapshot),
          movedBookingRequestIds,
          movedAppointmentIds,
          mergedTags,
          notesAppended,
          bonusRule,
          totalSpentRule,
        },
      },
    });

    await tx.clientDuplicateReview.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        status: "NOT_DUPLICATE",
        note: "Группа объединена вручную",
        reviewedByUserId: input.mergedByUserId,
      },
      update: {
        status: "NOT_DUPLICATE",
        note: "Группа объединена вручную",
        reviewedByUserId: input.mergedByUserId,
      },
    });

    return log.id;
  });

  return {
    mergeLogId,
    targetClientId,
    sourceClientIds,
  };
}
