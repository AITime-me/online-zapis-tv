import "server-only";

import {
  appointmentPhoneToE164,
  BOT_BOOKING_METHOD_FEED_KINDS,
  isBotBookingMethodFeedKind,
  type BotBookingMethodContextRequest,
  type BotBookingMethodContextSuccess,
  type BotBookingMethodErrorCode,
  type BotBookingMethodFeedRequest,
  type BotBookingMethodFeedSuccess,
} from "@/lib/bot-api/booking-method-types";
import { prisma } from "@/lib/db";
import { safeLogError } from "@/lib/logging/redact";
import { mapStoredSiteAttribution } from "@/services/SiteAttributionService";

type ServiceResult<T> =
  | { ok: true; body: T }
  | { ok: false; code: BotBookingMethodErrorCode; httpStatus: number };

function fail(
  code: BotBookingMethodErrorCode,
  httpStatus = code === "NOT_FOUND" ? 404 : code === "INTERNAL_ERROR" ? 500 : 400,
): ServiceResult<never> {
  return { ok: false, code, httpStatus };
}

/**
 * Keyset feed of appointments whose creator_kind is SELF_SERVICE|MANAGER|MASTER.
 * TEYA and NULL are never emitted (A1 owns TEYA; NULL is never synced).
 */
export async function feedBotBookingMethodAppointments(
  input: BotBookingMethodFeedRequest,
): Promise<ServiceResult<BotBookingMethodFeedSuccess>> {
  try {
    const cursorCreatedAt = input.cursor
      ? new Date(input.cursor.createdAt)
      : null;
    if (input.cursor && !Number.isFinite(cursorCreatedAt?.getTime())) {
      return fail("VALIDATION_ERROR");
    }

    const rows = await prisma.appointment.findMany({
      where: {
        creatorKind: { in: [...BOT_BOOKING_METHOD_FEED_KINDS] },
        ...(input.cursor && cursorCreatedAt
          ? {
              OR: [
                { createdAt: { gt: cursorCreatedAt } },
                {
                  AND: [
                    { createdAt: cursorCreatedAt },
                    { id: { gt: input.cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        createdAt: true,
        creatorKind: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
    });

    const page = rows.slice(0, input.limit);
    const items = [];
    for (const row of page) {
      if (!isBotBookingMethodFeedKind(row.creatorKind)) {
        continue;
      }
      items.push({
        appointmentId: row.id,
        creatorKind: row.creatorKind,
        createdAt: row.createdAt.toISOString(),
      });
    }

    const hasMore = rows.length > input.limit;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? { createdAt: last.createdAt.toISOString(), id: last.id }
        : null;

    return {
      ok: true,
      body: { ok: true, items, nextCursor },
    };
  } catch (error) {
    safeLogError("bot-booking-method-feed", error);
    return fail("INTERNAL_ERROR");
  }
}

/**
 * Narrow identity context for CRM deal discovery. Phone only — no name.
 * Rejects TEYA/NULL/OTHER so A2.2 never syncs those via this path.
 */
export async function getBotBookingMethodAppointmentContext(
  input: BotBookingMethodContextRequest,
): Promise<ServiceResult<BotBookingMethodContextSuccess>> {
  try {
    const row = await prisma.appointment.findUnique({
      where: { id: input.appointmentId },
      select: {
        id: true,
        creatorKind: true,
        clientPhone: true,
        siteAttribution: {
          select: {
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            utmContent: true,
            utmTerm: true,
            referrer: true,
            sourceMarker: true,
          },
        },
      },
    });
    if (!row) {
      return fail("NOT_FOUND");
    }
    if (!isBotBookingMethodFeedKind(row.creatorKind)) {
      return fail("NOT_FOUND");
    }
    const phoneE164 = appointmentPhoneToE164(row.clientPhone);
    if (!phoneE164) {
      return fail("NOT_FOUND");
    }
    return {
      ok: true,
      body: {
        ok: true,
        appointmentId: row.id,
        creatorKind: row.creatorKind,
        phoneE164,
        attribution: mapStoredSiteAttribution(row.siteAttribution),
      },
    };
  } catch (error) {
    safeLogError("bot-booking-method-context", error);
    return fail("INTERNAL_ERROR");
  }
}
