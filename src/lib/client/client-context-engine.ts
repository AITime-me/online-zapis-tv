import { getStudioNow } from "@/lib/datetime/date-layer";

export type ClientBookingStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

export type ClientBookingRecord = {
  id: string;
  serviceId?: string | null;
  status: ClientBookingStatus;
  startsAt: string | Date;
  source?: string | null;
};

export type ClientContextInput = {
  clientId?: string | null;
  phone?: string | null;
  bookings?: ClientBookingRecord[] | null;
};

export type ClientVisitHistory = {
  totalBookings: number;
  completedVisits: number;
  cancelledBookings: number;
  noShowCount: number;
  upcomingBookings: number;
  lastVisitAt: string | null;
  firstVisitAt: string | null;
  visitedServiceIds: string[];
};

export type ClientBehaviorSignals = {
  isReturningClient: boolean;
  hasUpcomingBooking: boolean;
  hasNoShowHistory: boolean;
  prefersOnlineBooking: boolean;
  bookingFrequency: "none" | "low" | "regular";
};

export type ClientContext = {
  clientId: string | null;
  phone: string | null;
  isNewClient: boolean;
  isFirstVisit: boolean;
  visitHistory: ClientVisitHistory;
  signals: ClientBehaviorSignals;
};

/** Безопасный контекст для публичного booking API (без PII и сырых записей). */
export type PublicClientContext = {
  isFirstVisit: boolean;
  isNewClient: boolean;
  visitHistory: {
    completedVisits: number;
    upcomingBookings: number;
    noShowCount: number;
    cancelledBookings: number;
    visitedServiceIds: string[];
  };
  signals: ClientBehaviorSignals;
};

const COMPLETED_STATUSES: ReadonlySet<ClientBookingStatus> = new Set(["COMPLETED"]);
const UPCOMING_STATUSES: ReadonlySet<ClientBookingStatus> = new Set([
  "SCHEDULED",
  "CONFIRMED",
]);

export const EMPTY_CLIENT_CONTEXT: ClientContext = {
  clientId: null,
  phone: null,
  isNewClient: true,
  isFirstVisit: true,
  visitHistory: {
    totalBookings: 0,
    completedVisits: 0,
    cancelledBookings: 0,
    noShowCount: 0,
    upcomingBookings: 0,
    lastVisitAt: null,
    firstVisitAt: null,
    visitedServiceIds: [],
  },
  signals: {
    isReturningClient: false,
    hasUpcomingBooking: false,
    hasNoShowHistory: false,
    prefersOnlineBooking: false,
    bookingFrequency: "none",
  },
};

/** Нормализует телефон до цифр для сопоставления записей. */
export function normalizeClientPhone(
  phone: string | null | undefined,
): string | null {
  if (!phone?.trim()) {
    return null;
  }

  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

function parseBookingDate(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toIsoString(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function resolveBookingFrequency(
  completedVisits: number,
): ClientBehaviorSignals["bookingFrequency"] {
  if (completedVisits === 0) {
    return "none";
  }
  if (completedVisits === 1) {
    return "low";
  }
  return "regular";
}

function buildVisitHistory(
  bookings: ClientBookingRecord[],
  now: Date,
): ClientVisitHistory {
  let completedVisits = 0;
  let cancelledBookings = 0;
  let noShowCount = 0;
  let upcomingBookings = 0;
  let lastVisitAt: Date | null = null;
  let firstVisitAt: Date | null = null;
  const visitedServiceIds = new Set<string>();

  for (const booking of bookings) {
    const startsAt = parseBookingDate(booking.startsAt);

    if (COMPLETED_STATUSES.has(booking.status)) {
      completedVisits += 1;

      if (startsAt) {
        if (!lastVisitAt || startsAt > lastVisitAt) {
          lastVisitAt = startsAt;
        }
        if (!firstVisitAt || startsAt < firstVisitAt) {
          firstVisitAt = startsAt;
        }
      }

      if (booking.serviceId) {
        visitedServiceIds.add(booking.serviceId);
      }
      continue;
    }

    if (booking.status === "CANCELLED") {
      cancelledBookings += 1;
      continue;
    }

    if (booking.status === "NO_SHOW") {
      noShowCount += 1;
      continue;
    }

    if (
      startsAt &&
      UPCOMING_STATUSES.has(booking.status) &&
      startsAt >= now
    ) {
      upcomingBookings += 1;
    }
  }

  return {
    totalBookings: bookings.length,
    completedVisits,
    cancelledBookings,
    noShowCount,
    upcomingBookings,
    lastVisitAt: toIsoString(lastVisitAt),
    firstVisitAt: toIsoString(firstVisitAt),
    visitedServiceIds: [...visitedServiceIds],
  };
}

function buildBehaviorSignals(
  visitHistory: ClientVisitHistory,
  bookings: ClientBookingRecord[],
): ClientBehaviorSignals {
  const onlineBookings = bookings.filter(
    (booking) => booking.source?.toUpperCase() === "ONLINE",
  ).length;

  return {
    isReturningClient: visitHistory.completedVisits > 0,
    hasUpcomingBooking: visitHistory.upcomingBookings > 0,
    hasNoShowHistory: visitHistory.noShowCount > 0,
    prefersOnlineBooking:
      bookings.length > 0 && onlineBookings / bookings.length >= 0.5,
    bookingFrequency: resolveBookingFrequency(visitHistory.completedVisits),
  };
}

/** Единая точка определения контекста клиента для promo/booking. */
export function buildClientContext(
  input: ClientContextInput = {},
  now: Date = getStudioNow(),
): ClientContext {
  const clientId = input.clientId?.trim() || null;
  const phone = normalizeClientPhone(input.phone);
  const bookings = input.bookings ?? [];

  if (bookings.length === 0 && !clientId && !phone) {
    return EMPTY_CLIENT_CONTEXT;
  }

  const visitHistory = buildVisitHistory(bookings, now);
  const signals = buildBehaviorSignals(visitHistory, bookings);
  const isNewClient = visitHistory.completedVisits === 0;
  const isFirstVisit = isNewClient;

  return {
    clientId,
    phone,
    isNewClient,
    isFirstVisit,
    visitHistory,
    signals,
  };
}

/** Адаптер для promo-engine / gift-engine / rules-engine. */
export function toPromoClientContext(context: ClientContext): {
  clientId: string | null;
  isFirstVisit: boolean;
} {
  return {
    clientId: context.clientId,
    isFirstVisit: context.isFirstVisit,
  };
}

/** Публичный safe-ответ без телефона, id записей и дат визитов. */
export function toPublicClientContext(context: ClientContext): PublicClientContext {
  return {
    isFirstVisit: context.isFirstVisit,
    isNewClient: context.isNewClient,
    visitHistory: {
      completedVisits: context.visitHistory.completedVisits,
      upcomingBookings: context.visitHistory.upcomingBookings,
      noShowCount: context.visitHistory.noShowCount,
      cancelledBookings: context.visitHistory.cancelledBookings,
      visitedServiceIds: context.visitHistory.visitedServiceIds,
    },
    signals: { ...context.signals },
  };
}

/** Был ли завершённый визит по конкретной услуге. */
export function hasCompletedServiceVisit(
  context: ClientContext,
  serviceId: string,
): boolean {
  return context.visitHistory.visitedServiceIds.includes(serviceId);
}

/** Был ли завершённый визит в категории (по serviceId из истории). */
export function hasCompletedCategoryVisit(
  context: ClientContext,
  serviceIdsInCategory: string[],
): boolean {
  const categoryServiceIds = new Set(serviceIdsInCategory);
  return context.visitHistory.visitedServiceIds.some((serviceId) =>
    categoryServiceIds.has(serviceId),
  );
}
