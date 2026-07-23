import "server-only";

import type {
  Appointment,
  AppointmentSource,
  Client,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { mergeClientTags } from "@/lib/clients/tags";
import {
  getPhoneMatchSuffix,
  normalizePhone,
  resolveClientPhoneMatchKey,
} from "@/lib/phone/normalize-phone";
import { classifyClientPhone } from "@/lib/phone/usable-client-phone";
import { safeLogError } from "@/lib/logging/redact";
import { getStudioNow } from "@/lib/datetime/date-layer";
import {
  APPOINTMENT_CLIENT_SOURCE_LABELS,
  APPOINTMENT_CLIENT_SOURCE_TAGS,
  type AppointmentClientCandidate,
  type AppointmentClientLinkResult,
} from "@/types/appointment-client-link";

type Tx = Prisma.TransactionClient;

type AppointmentForLink = Appointment & {
  service: { publicName: string } | null;
  client: Client | null;
};

function maxDate(left: Date | null | undefined, right: Date): Date {
  if (!left) {
    return right;
  }
  return left.getTime() >= right.getTime() ? left : right;
}

function buildServiceTags(
  source: AppointmentSource,
  serviceName: string | null | undefined,
): string[] {
  const base = [...(APPOINTMENT_CLIENT_SOURCE_TAGS[source] ?? [])];
  const serviceTag = serviceName?.trim();
  if (serviceTag) {
    base.push(serviceTag);
  }
  return mergeClientTags([], base);
}

async function advisoryLockByPhoneMatchKey(
  tx: Tx,
  matchKey: string,
): Promise<void> {
  // Transaction-scoped lock; key = resolveClientPhoneMatchKey (no PII logs).
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${matchKey}))
  `;
}

async function findActiveClientsByPhone(
  tx: Tx,
  phone: string,
): Promise<Client[]> {
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

  const matches = await tx.client.findMany({
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

function mapCandidate(client: Client): AppointmentClientCandidate {
  return {
    id: client.id,
    fullName: client.fullName,
    phone: client.phone,
    status: client.status,
  };
}

async function resolveLinkedClient(
  tx: Tx,
  appointment: AppointmentForLink,
): Promise<{ client: Client; redirected: boolean } | null> {
  if (!appointment.clientId) {
    return null;
  }

  let client =
    appointment.client ??
    (await tx.client.findUnique({ where: { id: appointment.clientId } }));

  if (!client) {
    return null;
  }

  let redirected = false;
  if (client.mergedIntoClientId) {
    const target = await tx.client.findUnique({
      where: { id: client.mergedIntoClientId },
    });
    if (!target || target.isArchived || target.mergedIntoClientId) {
      return null;
    }
    client = target;
    redirected = true;
  }

  if (client.isArchived) {
    return { client, redirected };
  }

  return { client, redirected };
}

async function applyVisitUpdate(
  tx: Tx,
  client: Client,
  appointment: AppointmentForLink,
): Promise<Client> {
  const now = getStudioNow();
  const serviceTags = buildServiceTags(
    appointment.source,
    appointment.service?.publicName,
  );

  const data: Prisma.ClientUpdateInput = {
    lastContactAt: now,
    lastVisitAt: maxDate(client.lastVisitAt, appointment.startsAt),
  };

  if (client.status === "NEW" || client.status === "INACTIVE") {
    data.status = "ACTIVE";
  }

  if (!client.source?.trim()) {
    data.source = APPOINTMENT_CLIENT_SOURCE_LABELS[appointment.source];
  }

  if (serviceTags.length > 0) {
    data.tags = mergeClientTags(client.tags, serviceTags);
  }

  return tx.client.update({
    where: { id: client.id },
    data,
  });
}

async function createActiveClientFromAppointment(
  tx: Tx,
  appointment: AppointmentForLink,
  normalizedPhone: string,
): Promise<Client> {
  const now = getStudioNow();
  const phone = appointment.clientPhone.trim();
  const tags = buildServiceTags(
    appointment.source,
    appointment.service?.publicName,
  );

  return tx.client.create({
    data: {
      fullName: appointment.clientName.trim() || "Клиент",
      phone,
      normalizedPhone,
      source: APPOINTMENT_CLIENT_SOURCE_LABELS[appointment.source],
      status: "ACTIVE",
      isArchived: false,
      tags,
      lastVisitAt: appointment.startsAt,
      lastContactAt: now,
    },
  });
}

async function linkAppointmentToClient(
  tx: Tx,
  appointmentId: string,
  clientId: string,
): Promise<void> {
  await tx.appointment.update({
    where: { id: appointmentId },
    data: { client: { connect: { id: clientId } } },
  });
}

/**
 * CRM sync для COMPLETED appointment.
 * Вызывать только после успешного сохранения статуса (отдельная tx).
 */
export async function syncCompletedAppointmentClientLink(
  appointmentId: string,
): Promise<AppointmentClientLinkResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { service: true, client: true },
      });

      if (!appointment) {
        return {
          status: "error",
          message: "Запись не найдена",
        };
      }

      if (appointment.status !== "COMPLETED") {
        return { status: "not_applicable" };
      }

      const linked = await resolveLinkedClient(tx, appointment);
      if (linked) {
        if (linked.redirected && !linked.client.isArchived) {
          await linkAppointmentToClient(tx, appointment.id, linked.client.id);
        }
        if (!linked.client.isArchived) {
          await applyVisitUpdate(tx, linked.client, appointment);
        }
        return {
          status: "already_linked",
          clientId: linked.client.id,
        };
      }

      // clientId был, но клиент исчез / битый merge — продолжаем как без связи.
      if (appointment.clientId && !linked) {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { client: { disconnect: true } },
        });
      }

      const phoneClass = classifyClientPhone(appointment.clientPhone);
      if (!phoneClass.ok) {
        if (phoneClass.reason === "technical") {
          return { status: "skipped_technical_phone" };
        }
        return { status: "skipped_invalid_phone" };
      }

      const matchKey = resolveClientPhoneMatchKey(appointment.clientPhone);
      if (!matchKey) {
        return { status: "skipped_invalid_phone" };
      }

      await advisoryLockByPhoneMatchKey(tx, matchKey);

      const matches = await findActiveClientsByPhone(
        tx,
        appointment.clientPhone,
      );

      if (matches.length > 1) {
        return {
          status: "duplicate",
          candidates: matches.map(mapCandidate),
        };
      }

      if (matches.length === 1) {
        const updated = await applyVisitUpdate(tx, matches[0]!, appointment);
        await linkAppointmentToClient(tx, appointment.id, updated.id);
        return { status: "linked", clientId: updated.id };
      }

      const created = await createActiveClientFromAppointment(
        tx,
        appointment,
        phoneClass.normalized,
      );
      await linkAppointmentToClient(tx, appointment.id, created.id);
      return { status: "created", clientId: created.id };
    });
  } catch (error) {
    safeLogError("appointment.clientLink.sync", error, {
      appointmentId,
    });
    return {
      status: "error",
      message: "Не удалось привязать клиента",
    };
  }
}

type ClientLookupDb = {
  client: {
    findUnique: Tx["client"]["findUnique"];
  };
};

/**
 * Проверка клиента для connect. Передавать TransactionClient той же write-tx.
 */
export async function assertLinkableClientForAppointment(
  clientId: string,
  db: ClientLookupDb = prisma,
): Promise<Client> {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw new Error("CLIENT_NOT_FOUND");
  }
  if (client.isArchived) {
    throw new Error("CLIENT_ARCHIVED");
  }
  if (client.mergedIntoClientId) {
    throw new Error("CLIENT_MERGED");
  }
  return client;
}

export async function suggestClientsForAppointmentForm(input: {
  q: string;
  mode: "name" | "phone";
  limit?: number;
}): Promise<AppointmentClientCandidate[]> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 8);
  const q = input.q.trim();

  if (input.mode === "name") {
    if (q.length < 2) {
      return [];
    }
    const rows = await prisma.client.findMany({
      where: {
        isArchived: false,
        mergedIntoClientId: null,
        fullName: { contains: q, mode: "insensitive" },
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return rows;
  }

  const digits = q.replace(/\D/g, "");
  if (digits.length < 4) {
    return [];
  }

  const normalized = normalizePhone(q);
  const suffix = getPhoneMatchSuffix(q) ?? digits.slice(-Math.min(digits.length, 10));

  const rows = await prisma.client.findMany({
    where: {
      isArchived: false,
      mergedIntoClientId: null,
      OR: [
        ...(normalized ? [{ normalizedPhone: { contains: normalized } }] : []),
        { normalizedPhone: { endsWith: suffix } },
        { phone: { contains: digits } },
      ],
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      status: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows;
}
