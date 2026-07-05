import { Prisma } from "@prisma/client";
import {
  buildClientContext,
  EMPTY_CLIENT_CONTEXT,
  normalizeClientPhone,
  toPublicClientContext,
  type ClientBookingRecord,
  type ClientBookingStatus,
  type ClientContext,
  type PublicClientContext,
} from "@/lib/client/client-context-engine";
import { prisma } from "@/lib/db";

type AppointmentRow = {
  id: string;
  service_id: string | null;
  status: ClientBookingStatus;
  starts_at: Date;
  source: string;
};

const BOOKING_HISTORY_LIMIT = 100;

function mapAppointmentRow(row: AppointmentRow): ClientBookingRecord {
  return {
    id: row.id,
    serviceId: row.service_id,
    status: row.status,
    startsAt: row.starts_at,
    source: row.source,
  };
}

async function loadClientBookingsByPhone(
  normalizedPhone: string,
): Promise<ClientBookingRecord[]> {
  const phoneSuffix = normalizedPhone.slice(-10);

  if (phoneSuffix.length < 10) {
    return [];
  }

  const rows = await prisma.$queryRaw<AppointmentRow[]>(
    Prisma.sql`
      SELECT
        id,
        service_id,
        status::text AS status,
        starts_at,
        source::text AS source
      FROM appointments
      WHERE length(regexp_replace(client_phone, '[^0-9]', '', 'g')) >= 10
        AND right(regexp_replace(client_phone, '[^0-9]', '', 'g'), 10) = ${phoneSuffix}
      ORDER BY starts_at DESC
      LIMIT ${BOOKING_HISTORY_LIMIT}
    `,
  );

  return rows.map(mapAppointmentRow);
}

export async function resolveClientContextByPhone(
  phone: string,
): Promise<ClientContext> {
  const normalizedPhone = normalizeClientPhone(phone);

  if (!normalizedPhone) {
    return EMPTY_CLIENT_CONTEXT;
  }

  const bookings = await loadClientBookingsByPhone(normalizedPhone);

  return buildClientContext({
    phone: normalizedPhone,
    bookings,
  });
}

export async function resolvePublicClientContextByPhone(
  phone: string,
): Promise<PublicClientContext> {
  return toPublicClientContext(await resolveClientContextByPhone(phone));
}
