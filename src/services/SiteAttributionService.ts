import "server-only";

import type { Prisma } from "@prisma/client";
import {
  hasObservedSiteAttribution,
  parseSiteAttribution,
  type SiteAttribution,
} from "@/lib/attribution/site-attribution";

type AttributionDb = Pick<Prisma.TransactionClient, "siteAttribution">;

type StoredSiteAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  sourceMarker: string | null;
};

const SITE_ATTRIBUTION_SELECT = {
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  utmContent: true,
  utmTerm: true,
  referrer: true,
  sourceMarker: true,
} as const;

export function mapStoredSiteAttribution(
  value: StoredSiteAttribution | null | undefined,
): SiteAttribution | null {
  if (!value) {
    return null;
  }
  return {
    utm_source: value.utmSource,
    utm_medium: value.utmMedium,
    utm_campaign: value.utmCampaign,
    utm_content: value.utmContent,
    utm_term: value.utmTerm,
    referrer: value.referrer,
    source_marker: value.sourceMarker,
  };
}

function createData(value: SiteAttribution) {
  return {
    utmSource: value.utm_source,
    utmMedium: value.utm_medium,
    utmCampaign: value.utm_campaign,
    utmContent: value.utm_content,
    utmTerm: value.utm_term,
    referrer: value.referrer,
    sourceMarker: value.source_marker,
  };
}

function normalizeForPersistence(
  attribution: SiteAttribution | null | undefined,
): SiteAttribution | null {
  if (!attribution) {
    return null;
  }
  const parsed = parseSiteAttribution(attribution);
  if (!parsed.ok) {
    throw new Error("INVALID_SITE_ATTRIBUTION_PERSISTENCE_INPUT");
  }
  return hasObservedSiteAttribution(parsed.value) ? parsed.value : null;
}

export async function createAppointmentSiteAttribution(
  db: AttributionDb,
  appointmentId: string,
  attribution: SiteAttribution | null | undefined,
): Promise<void> {
  const normalized = normalizeForPersistence(attribution);
  if (!normalized) {
    return;
  }
  await db.siteAttribution.create({
    data: {
      appointmentId,
      ...createData(normalized),
    },
  });
}

export async function createBookingRequestSiteAttribution(
  db: AttributionDb,
  bookingRequestId: string,
  attribution: SiteAttribution | null | undefined,
): Promise<void> {
  const normalized = normalizeForPersistence(attribution);
  if (!normalized) {
    return;
  }
  await db.siteAttribution.create({
    data: {
      bookingRequestId,
      ...createData(normalized),
    },
  });
}

export async function getAppointmentSiteAttribution(
  db: AttributionDb,
  appointmentId: string,
): Promise<SiteAttribution | null> {
  const row = await db.siteAttribution.findUnique({
    where: { appointmentId },
    select: SITE_ATTRIBUTION_SELECT,
  });
  return mapStoredSiteAttribution(row);
}

export async function getBookingRequestSiteAttribution(
  db: AttributionDb,
  bookingRequestId: string,
): Promise<SiteAttribution | null> {
  const row = await db.siteAttribution.findUnique({
    where: { bookingRequestId },
    select: SITE_ATTRIBUTION_SELECT,
  });
  return mapStoredSiteAttribution(row);
}
