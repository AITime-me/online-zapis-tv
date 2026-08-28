import "server-only";

import {
  formatFeedOrder,
  isAcquisitionSourceWireKey,
  isBotAcquisitionSourceOwnerKind,
  ownerPhoneToE164,
  parseCanonicalPositiveDecimalString,
  type BotAcquisitionSourceContextRequest,
  type BotAcquisitionSourceContextSuccess,
  type BotAcquisitionSourceErrorCode,
  type BotAcquisitionSourceFeedRequest,
  type BotAcquisitionSourceFeedSuccess,
  type BotAcquisitionSourceOwnerKind,
} from "@/lib/bot-api/acquisition-source-types";
import { prisma } from "@/lib/db";
import { safeLogError } from "@/lib/logging/redact";

type ServiceResult<T> =
  | { ok: true; body: T }
  | { ok: false; code: BotAcquisitionSourceErrorCode; httpStatus: number };

function fail(
  code: BotAcquisitionSourceErrorCode,
  httpStatus = code === "NOT_FOUND" ? 404 : code === "INTERNAL_ERROR" ? 500 : 400,
): ServiceResult<never> {
  return { ok: false, code, httpStatus };
}

function resolveOwnerFromEvidence(row: {
  appointmentId: string | null;
  bookingRequestId: string | null;
}): { ownerKind: BotAcquisitionSourceOwnerKind; ownerId: string } | null {
  if (row.appointmentId && !row.bookingRequestId) {
    return { ownerKind: "APPOINTMENT", ownerId: row.appointmentId };
  }
  if (row.bookingRequestId && !row.appointmentId) {
    return { ownerKind: "BOOKING_REQUEST", ownerId: row.bookingRequestId };
  }
  return null;
}

/**
 * Keyset feed of commit-ordered AcquisitionEvidence rows only.
 * Pagination uses feedOrder (integer) — never consumedAt.
 * sourceKey is read from acquisition_evidence — never SiteAttribution.
 */
export async function feedBotAcquisitionSourceEvidence(
  input: BotAcquisitionSourceFeedRequest,
): Promise<ServiceResult<BotAcquisitionSourceFeedSuccess>> {
  try {
    const cursorFeedOrder = input.cursor
      ? parseCanonicalPositiveDecimalString(input.cursor.feedOrder)
      : null;
    if (input.cursor && cursorFeedOrder === null) {
      return fail("VALIDATION_ERROR");
    }

    const rows = await prisma.acquisitionEvidence.findMany({
      where: {
        feedOrder: { not: null },
        ...(input.cursor && cursorFeedOrder !== null
          ? {
              OR: [
                { feedOrder: { gt: cursorFeedOrder } },
                {
                  AND: [
                    { feedOrder: cursorFeedOrder },
                    { id: { gt: input.cursor.evidenceId } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        sourceKey: true,
        consumedAt: true,
        feedOrder: true,
        appointmentId: true,
        bookingRequestId: true,
      },
      orderBy: [{ feedOrder: "asc" }, { id: "asc" }],
      take: input.limit + 1,
    });

    const page = rows.slice(0, input.limit);
    const items = [];
    for (const row of page) {
      if (row.feedOrder === null) {
        continue;
      }
      if (!isAcquisitionSourceWireKey(row.sourceKey)) {
        continue;
      }
      const owner = resolveOwnerFromEvidence(row);
      if (!owner) {
        continue;
      }
      items.push({
        evidenceId: row.id,
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
        sourceKey: row.sourceKey,
        consumedAt: row.consumedAt?.toISOString() ?? new Date(0).toISOString(),
        feedOrder: formatFeedOrder(row.feedOrder),
      });
    }

    const hasMore = rows.length > input.limit;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last?.feedOrder !== null && last?.feedOrder !== undefined
        ? {
            feedOrder: formatFeedOrder(last.feedOrder),
            evidenceId: last.id,
          }
        : null;

    return {
      ok: true,
      body: { ok: true, items, nextCursor },
    };
  } catch (error) {
    safeLogError("bot-acquisition-source-feed", error);
    return fail("INTERNAL_ERROR");
  }
}

/**
 * Re-read consumed evidence by id; verify owner binding; return phone for CRM.
 * Never reads SiteAttribution.source_marker.
 */
export async function getBotAcquisitionSourceContext(
  input: BotAcquisitionSourceContextRequest,
): Promise<ServiceResult<BotAcquisitionSourceContextSuccess>> {
  try {
    if (!isBotAcquisitionSourceOwnerKind(input.ownerKind)) {
      return fail("NOT_FOUND");
    }

    const row = await prisma.acquisitionEvidence.findUnique({
      where: { id: input.evidenceId },
      select: {
        id: true,
        sourceKey: true,
        consumedAt: true,
        appointmentId: true,
        bookingRequestId: true,
        appointment: { select: { clientPhone: true } },
        bookingRequest: { select: { clientPhone: true } },
      },
    });

    if (!row || !row.consumedAt) {
      return fail("NOT_FOUND");
    }
    if (!isAcquisitionSourceWireKey(row.sourceKey)) {
      return fail("NOT_FOUND");
    }

    const owner = resolveOwnerFromEvidence(row);
    if (
      !owner ||
      owner.ownerKind !== input.ownerKind ||
      owner.ownerId !== input.ownerId
    ) {
      return fail("NOT_FOUND");
    }

    const rawPhone =
      input.ownerKind === "APPOINTMENT"
        ? row.appointment?.clientPhone
        : row.bookingRequest?.clientPhone;
    const phoneE164 = ownerPhoneToE164(rawPhone);
    if (!phoneE164) {
      return fail("NOT_FOUND");
    }

    return {
      ok: true,
      body: {
        ok: true,
        evidenceId: row.id,
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
        sourceKey: row.sourceKey,
        phoneE164,
      },
    };
  } catch (error) {
    safeLogError("bot-acquisition-source-context", error);
    return fail("INTERNAL_ERROR");
  }
}
