import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getActiveDuplicateClientIdSet } from "@/services/ClientDuplicateService";
import type { ClientDetailResult } from "@/types/client-detail";

const HISTORY_LIMIT = 20;

const clientDetailSelect = {
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
  mergedIntoClientId: true,
  mergedAt: true,
  mergedByUserId: true,
  mergeNote: true,
  createdAt: true,
  updatedAt: true,
  mergedIntoClient: {
    select: {
      id: true,
      fullName: true,
    },
  },
  mergedByUser: {
    select: {
      id: true,
      name: true,
    },
  },
  _count: {
    select: {
      bookingRequests: true,
      appointments: true,
    },
  },
} satisfies Prisma.ClientSelect;

type ClientDetailRow = Prisma.ClientGetPayload<{
  select: typeof clientDetailSelect;
}>;

function parseSourceClientIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function mapClient(
  row: ClientDetailRow,
  hasActiveDuplicate: boolean,
): ClientDetailResult["client"] {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    normalizedPhone: row.normalizedPhone,
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
    mergedIntoClientId: row.mergedIntoClientId,
    mergedIntoClientName: row.mergedIntoClient?.fullName ?? null,
    mergedAt: row.mergedAt?.toISOString() ?? null,
    mergedByUserId: row.mergedByUserId,
    mergedByUserName: row.mergedByUser?.name ?? null,
    mergeNote: row.mergeNote,
    hasActiveDuplicate,
  };
}

export async function getClientDetailsForAdmin(
  clientId: string,
): Promise<ClientDetailResult | null> {
  const now = new Date();

  const [activeDuplicateIds, client] = await Promise.all([
    getActiveDuplicateClientIdSet(),
    prisma.client.findUnique({
      where: { id: clientId },
      select: clientDetailSelect,
    }),
  ]);

  if (!client) {
    return null;
  }

  const hasActiveDuplicate = activeDuplicateIds.has(client.id);

  const [
    bookingRequestRows,
    appointmentRows,
    mergedSources,
    mergeLogs,
    activeBookingRequests,
    closedBookingRequests,
    nextAppointment,
    lastAppointment,
  ] = await Promise.all([
    prisma.bookingRequest.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT + 1,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        clientName: true,
        clientPhone: true,
        comment: true,
        status: true,
        type: true,
        source: true,
        serviceNameSnapshot: true,
        master: { select: { publicName: true } },
      },
    }),
    prisma.appointment.findMany({
      where: { clientId },
      orderBy: { startsAt: "desc" },
      take: HISTORY_LIMIT + 1,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        comment: true,
        importantNote: true,
        master: { select: { publicName: true } },
        service: { select: { publicName: true } },
      },
    }),
    prisma.client.findMany({
      where: { mergedIntoClientId: clientId },
      orderBy: { mergedAt: "desc" },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        mergedAt: true,
      },
    }),
    prisma.clientMergeLog.findMany({
      where: { targetClientId: clientId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        reason: true,
        sourceClientIds: true,
        mergedByUser: { select: { name: true } },
      },
    }),
    prisma.bookingRequest.count({
      where: {
        clientId,
        status: { in: ["NEW", "CONTACTED"] },
      },
    }),
    prisma.bookingRequest.count({
      where: {
        clientId,
        status: "CLOSED",
      },
    }),
    prisma.appointment.findFirst({
      where: {
        clientId,
        startsAt: { gte: now },
        status: { in: ["SCHEDULED", "CONFIRMED"] },
      },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    }),
    prisma.appointment.findFirst({
      where: { clientId },
      orderBy: { startsAt: "desc" },
      select: { startsAt: true },
    }),
  ]);

  const bookingRequestsTruncated = bookingRequestRows.length > HISTORY_LIMIT;
  const appointmentsTruncated = appointmentRows.length > HISTORY_LIMIT;

  const allSourceIds = [
    ...new Set(
      mergeLogs.flatMap((log) => parseSourceClientIds(log.sourceClientIds)),
    ),
  ];
  const sourceClientsById = allSourceIds.length
    ? new Map(
        (
          await prisma.client.findMany({
            where: { id: { in: allSourceIds } },
            select: { id: true, fullName: true, phone: true },
          })
        ).map((row) => [row.id, row]),
      )
    : new Map<string, { id: string; fullName: string; phone: string | null }>();

  return {
    client: mapClient(client, hasActiveDuplicate),
    summary: {
      totalBookingRequests: client._count.bookingRequests,
      activeBookingRequests,
      closedBookingRequests,
      totalAppointments: client._count.appointments,
      nextAppointmentAt: nextAppointment?.startsAt.toISOString() ?? null,
      lastAppointmentAt: lastAppointment?.startsAt.toISOString() ?? null,
      hasActiveDuplicate,
      bonusBalance: client.bonusBalance,
    },
    bookingRequests: bookingRequestRows.slice(0, HISTORY_LIMIT).map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      comment: row.comment,
      status: row.status,
      type: row.type,
      source: row.source,
      masterName: row.master?.publicName ?? null,
      serviceNameSnapshot: row.serviceNameSnapshot ?? null,
    })),
    bookingRequestsTruncated,
    appointments: appointmentRows.slice(0, HISTORY_LIMIT).map((row) => ({
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      masterName: row.master.publicName,
      serviceName: row.service?.publicName ?? null,
      status: row.status,
      comment: row.comment,
      importantNote: row.importantNote,
    })),
    appointmentsTruncated,
    mergedClients: mergedSources.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      mergedAt: row.mergedAt?.toISOString() ?? null,
    })),
    mergeLogs: mergeLogs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      reason: log.reason,
      mergedByUserName: log.mergedByUser?.name ?? null,
      sourceClients: parseSourceClientIds(log.sourceClientIds)
        .map((id) => sourceClientsById.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => ({
          id: row.id,
          fullName: row.fullName,
          phone: row.phone,
        })),
    })),
    duplicateInfo: {
      hasActiveDuplicate,
      duplicatesSearchQuery: client.phone ?? client.fullName,
    },
  };
}
