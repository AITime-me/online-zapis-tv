import { Prisma } from "@prisma/client";
import { isOnlinePublicBookable } from "@/lib/booking/online-public-master-service";

/**
 * Авторитетная серверная policy-проверка пары мастер–услуга.
 * Выполняется под PostgreSQL row locks внутри appointment write-транзакции.
 */

export const MASTER_SERVICE_NOT_ASSIGNED_MESSAGE =
  "Услуга не назначена выбранному мастеру или отключена";

export const MASTER_SERVICE_ID_REQUIRED_MESSAGE = "Не указана услуга";

export const MASTER_ID_REQUIRED_MESSAGE = "Не указан мастер";

export const PUBLIC_ONLINE_SERVICE_UNAVAILABLE_MESSAGE =
  "Услуга или мастер недоступны для онлайн-записи";

export class MasterServiceAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterServiceAssignmentError";
  }
}

export type AppointmentServicePolicy = "INTERNAL" | "PUBLIC_ONLINE";

/**
 * Только transaction client: guard и appointment write обязаны использовать
 * один и тот же tx. Совместимый интерфейс позволяет runtime-тесту подставить fake.
 */
export type AppointmentServicePolicyTransaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw"
>;

type LockedAppointmentServicePolicyRow = {
  serviceId: string;
  serviceIsActive: boolean;
  serviceIsPublic: boolean;
  serviceIsOnlineBookingEnabled: boolean;
  categoryIsActive: boolean;
  categoryIsPublic: boolean;
  masterIsActive: boolean;
  masterIsPublic: boolean;
  masterIsOnlineBookingEnabled: boolean;
  masterServiceIsEnabled: boolean;
  masterServiceIsPublic: boolean;
  masterServiceIsOnlineBookingEnabled: boolean;
};

/**
 * Проверять назначение только при создании или смене пары masterId/serviceId.
 * Редактирование прочих полей исторической записи не требует действующей связи.
 * desiredServiceId должен быть непустой строкой — явный null отклоняется раньше.
 */
export function shouldValidateMasterServiceAssignment(input: {
  isCreate: boolean;
  existingMasterId?: string;
  existingServiceId?: string | null;
  desiredMasterId: string;
  desiredServiceId: string | null | undefined;
}): boolean {
  if (typeof input.desiredServiceId !== "string" || !input.desiredServiceId.trim()) {
    return false;
  }

  if (input.isCreate) {
    return true;
  }

  return (
    input.desiredMasterId !== input.existingMasterId ||
    input.desiredServiceId !== input.existingServiceId
  );
}

/**
 * Отличает отсутствие поля от явного null/пустой строки.
 * fieldPresent=true и null/"" → ошибка; fieldPresent=false → ок.
 */
export function assertWritableIdNotExplicitlyCleared(input: {
  fieldPresent: boolean;
  value: string | null | undefined;
  emptyMessage: string;
}): void {
  if (!input.fieldPresent) {
    return;
  }

  if (typeof input.value !== "string" || !input.value.trim()) {
    throw new MasterServiceAssignmentError(input.emptyMessage);
  }
}

/**
 * Блокирует master_services + services для INTERNAL.
 *
 * FOR SHARE конфликтует с UPDATE/DELETE этих строк. Параметры передаются через
 * Prisma.sql; имена таблиц/колонок соответствуют @@map/@map в schema.prisma.
 */
async function lockInternalPolicyRows(
  tx: AppointmentServicePolicyTransaction,
  masterId: string,
  serviceId: string,
): Promise<LockedAppointmentServicePolicyRow[]> {
  return tx.$queryRaw<LockedAppointmentServicePolicyRow[]>(Prisma.sql`
    SELECT
      s."id" AS "serviceId",
      s."is_active" AS "serviceIsActive",
      s."is_public" AS "serviceIsPublic",
      s."is_online_booking_enabled" AS "serviceIsOnlineBookingEnabled",
      FALSE AS "categoryIsActive",
      FALSE AS "categoryIsPublic",
      FALSE AS "masterIsActive",
      FALSE AS "masterIsPublic",
      FALSE AS "masterIsOnlineBookingEnabled",
      ms."is_enabled" AS "masterServiceIsEnabled",
      ms."is_public" AS "masterServiceIsPublic",
      ms."is_online_booking_enabled" AS "masterServiceIsOnlineBookingEnabled"
    FROM "master_services" AS ms
    INNER JOIN "services" AS s
      ON s."id" = ms."service_id"
    WHERE ms."master_id" = ${masterId}::uuid
      AND ms."service_id" = ${serviceId}::uuid
    FOR SHARE OF ms, s
  `);
}

/**
 * Блокирует полную PUBLIC_ONLINE цепочку:
 * master_services + services + service_categories + masters.
 */
async function lockPublicOnlinePolicyRows(
  tx: AppointmentServicePolicyTransaction,
  masterId: string,
  serviceId: string,
): Promise<LockedAppointmentServicePolicyRow[]> {
  return tx.$queryRaw<LockedAppointmentServicePolicyRow[]>(Prisma.sql`
    SELECT
      s."id" AS "serviceId",
      s."is_active" AS "serviceIsActive",
      s."is_public" AS "serviceIsPublic",
      s."is_online_booking_enabled" AS "serviceIsOnlineBookingEnabled",
      c."is_active" AS "categoryIsActive",
      c."is_public" AS "categoryIsPublic",
      m."is_active" AS "masterIsActive",
      m."is_public" AS "masterIsPublic",
      m."is_online_booking_enabled" AS "masterIsOnlineBookingEnabled",
      ms."is_enabled" AS "masterServiceIsEnabled",
      ms."is_public" AS "masterServiceIsPublic",
      ms."is_online_booking_enabled" AS "masterServiceIsOnlineBookingEnabled"
    FROM "master_services" AS ms
    INNER JOIN "services" AS s
      ON s."id" = ms."service_id"
    INNER JOIN "service_categories" AS c
      ON c."id" = s."category_id"
    INNER JOIN "masters" AS m
      ON m."id" = ms."master_id"
    WHERE ms."master_id" = ${masterId}::uuid
      AND ms."service_id" = ${serviceId}::uuid
    FOR SHARE OF ms, s, c, m
  `);
}

/**
 * Последняя авторитетная policy-проверка перед appointment.create/update.
 * Вызов допустим только внутри той же транзакции, что и последующий write.
 */
export async function lockAndAssertAppointmentServicePolicy(
  tx: AppointmentServicePolicyTransaction,
  input: {
    masterId: string;
    serviceId: string;
    policy: AppointmentServicePolicy;
  },
): Promise<void> {
  const rows =
    input.policy === "PUBLIC_ONLINE"
      ? await lockPublicOnlinePolicyRows(tx, input.masterId, input.serviceId)
      : await lockInternalPolicyRows(tx, input.masterId, input.serviceId);
  const row = rows[0];

  if (
    !row ||
    row.masterServiceIsEnabled !== true ||
    row.serviceIsActive !== true
  ) {
    throw new MasterServiceAssignmentError(
      input.policy === "PUBLIC_ONLINE"
        ? PUBLIC_ONLINE_SERVICE_UNAVAILABLE_MESSAGE
        : MASTER_SERVICE_NOT_ASSIGNED_MESSAGE,
    );
  }

  if (
    input.policy === "PUBLIC_ONLINE" &&
    !isOnlinePublicBookable({
      service: {
        id: row.serviceId,
        isActive: row.serviceIsActive,
        isPublic: row.serviceIsPublic,
        isOnlineBookingEnabled: row.serviceIsOnlineBookingEnabled,
        category: {
          isActive: row.categoryIsActive,
          isPublic: row.categoryIsPublic,
        },
      },
      master: {
        isActive: row.masterIsActive,
        isPublic: row.masterIsPublic,
        isOnlineBookingEnabled: row.masterIsOnlineBookingEnabled,
      },
      masterService: {
        isEnabled: row.masterServiceIsEnabled,
        isPublic: row.masterServiceIsPublic,
        isOnlineBookingEnabled: row.masterServiceIsOnlineBookingEnabled,
      },
    })
  ) {
    throw new MasterServiceAssignmentError(
      PUBLIC_ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
    );
  }
}
