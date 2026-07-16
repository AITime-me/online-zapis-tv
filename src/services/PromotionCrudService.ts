import type { Prisma } from "@prisma/client";
import { getStudioNow } from "@/lib/datetime/date-layer";
import { prisma } from "@/lib/db";
import {
  assertHomepageCtaFields,
  assertSafePromotionCtaLink,
} from "@/lib/promotions/cta-link-policy";
import {
  syncPromotionServicesInTx,
  validateNewPromotionServiceIds,
} from "@/lib/promotions/promotion-services-sync";
import {
  promotionSourceFromDb,
  promotionSourceToDb,
  promotionStatusFromDb,
  promotionStatusToDb,
  promotionTypeFromDb,
  promotionTypeToDb,
  slugifyPromotionTitle,
  discountUnitFromDb,
  discountUnitToDb,
  type PromotionDto,
  type PromotionServiceOption,
  type PromotionSourceDto,
  type PromotionStatusDto,
  type PromotionTypeDto,
  type PromotionWriteInput,
  type DiscountUnitDto,
} from "@/types/promotion-admin";

export class PromotionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionValidationError";
  }
}

export class PromotionNotFoundError extends Error {
  constructor(message = "Акция не найдена") {
    super(message);
    this.name = "PromotionNotFoundError";
  }
}

const promotionInclude = {
  services: {
    select: { serviceId: true },
  },
} satisfies Prisma.PromotionInclude;

/** Seed/demo-услуги помечены «(тест)» во внутреннем названии — не показываем в акциях. */
const promotionServiceOptionsWhere = {
  isActive: true,
  NOT: {
    internalName: {
      contains: "(тест)",
      mode: "insensitive" as const,
    },
  },
} satisfies Prisma.ServiceWhereInput;

type PromotionRow = Prisma.PromotionGetPayload<{
  include: typeof promotionInclude;
}>;

function mapPromotion(row: PromotionRow): PromotionDto {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    shortDescription: row.shortDescription,
    description: row.description,
    type: promotionTypeFromDb(row.type),
    status: promotionStatusFromDb(row.status),
    isActive: row.isActive,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    giftTitle: row.giftTitle,
    giftDescription: row.giftDescription,
    discountValue: row.discountValue?.toNumber() ?? null,
    discountUnit: row.discountUnit
      ? discountUnitFromDb(row.discountUnit)
      : null,
    discountDescription: row.discountDescription,
    conditions: row.conditions,
    ctaText: row.ctaText,
    ctaLink: row.ctaLink,
    imageUrl: row.imageUrl,
    priority: row.priority,
    source: promotionSourceFromDb(row.source),
    showOnHomepage: row.showOnHomepage,
    serviceIds: row.services.map((link) => link.serviceId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseOptionalDate(
  value: string | null | undefined,
  fieldLabel: string,
): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PromotionValidationError(`Некорректная дата: ${fieldLabel}`);
  }
  return date;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
  const existing = await prisma.promotion.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (existing && existing.id !== excludeId) {
    throw new PromotionValidationError("Slug уже используется другой акцией");
  }
}

function wrapSyncError(error: unknown): never {
  if (error instanceof PromotionValidationError) {
    throw error;
  }
  throw new PromotionValidationError(
    error instanceof Error ? error.message : "Ошибка привязки услуг",
  );
}

function parseDiscountValue(
  value: number | null | undefined,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new PromotionValidationError("Размер скидки должен быть больше нуля");
  }
  return value;
}

function applyDiscountFields(
  data: Prisma.PromotionUpdateInput,
  input: PromotionWriteInput,
): void {
  if (input.discountValue !== undefined) {
    const parsed = parseDiscountValue(input.discountValue);
    data.discountValue = parsed;
  }
  if (input.discountUnit !== undefined) {
    data.discountUnit =
      input.discountUnit === null ? null : discountUnitToDb(input.discountUnit);
  }
  if (input.discountDescription !== undefined) {
    data.discountDescription = input.discountDescription?.trim() || null;
  }
}

function validateDiscountCombination(
  discountValue: number | null | undefined,
  discountUnit: DiscountUnitDto | null | undefined,
): void {
  const hasValue = discountValue != null;
  const hasUnit = discountUnit != null;
  if (hasValue !== hasUnit) {
    throw new PromotionValidationError(
      "Укажите и размер скидки, и единицу измерения",
    );
  }
  if (
    discountValue != null &&
    discountUnit === "percent" &&
    discountValue > 100
  ) {
    throw new PromotionValidationError(
      "Процентная скидка не может быть больше 100",
    );
  }
}

function resolveCtaLinkForWrite(
  input: PromotionWriteInput,
): string | null | undefined {
  if (input.ctaLink === undefined) {
    return undefined;
  }
  try {
    return assertSafePromotionCtaLink(input.ctaLink);
  } catch (error) {
    throw new PromotionValidationError(
      error instanceof Error ? error.message : "Некорректная ссылка кнопки",
    );
  }
}

function assertHomepageRequirements(input: {
  showOnHomepage: boolean;
  ctaText: string | null | undefined;
  ctaLink: string | null | undefined;
}): void {
  try {
    assertHomepageCtaFields(input);
  } catch (error) {
    throw new PromotionValidationError(
      error instanceof Error ? error.message : "Недостаточно данных для главной",
    );
  }
}

function buildWriteData(input: PromotionWriteInput): Prisma.PromotionUpdateInput {
  const data: Prisma.PromotionUpdateInput = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) {
      throw new PromotionValidationError("Название акции обязательно");
    }
    data.title = title;
  }

  if (input.slug !== undefined) {
    const slug = normalizeSlug(input.slug);
    if (!slug) {
      throw new PromotionValidationError("Slug обязателен");
    }
    data.slug = slug;
  }

  if (input.shortDescription !== undefined) {
    data.shortDescription = input.shortDescription?.trim() || null;
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }
  if (input.type !== undefined) {
    data.type = promotionTypeToDb(input.type);
  }
  if (input.status !== undefined) {
    data.status = promotionStatusToDb(input.status);
  }
  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }
  if (input.startsAt !== undefined) {
    data.startsAt = parseOptionalDate(input.startsAt, "дата начала");
  }
  if (input.endsAt !== undefined) {
    data.endsAt = parseOptionalDate(input.endsAt, "дата окончания");
  }
  if (input.giftTitle !== undefined) {
    data.giftTitle = input.giftTitle?.trim() || null;
  }
  if (input.giftDescription !== undefined) {
    data.giftDescription = input.giftDescription?.trim() || null;
  }
  if (input.conditions !== undefined) {
    data.conditions = input.conditions?.trim() || null;
  }
  if (input.ctaText !== undefined) {
    data.ctaText = input.ctaText?.trim() || null;
  }
  if (input.ctaLink !== undefined) {
    data.ctaLink = resolveCtaLinkForWrite(input);
  }
  if (input.imageUrl !== undefined) {
    data.imageUrl = input.imageUrl?.trim() || null;
  }
  if (input.priority !== undefined) {
    if (!Number.isFinite(input.priority)) {
      throw new PromotionValidationError("Приоритет должен быть числом");
    }
    data.priority = Math.round(input.priority);
  }
  if (input.source !== undefined) {
    data.source = promotionSourceToDb(input.source);
  }
  if (input.showOnHomepage !== undefined) {
    data.showOnHomepage = input.showOnHomepage;
  }

  applyDiscountFields(data, input);
  validateDiscountCombination(input.discountValue, input.discountUnit);

  return data;
}

export async function listPromotionServiceOptions(): Promise<
  PromotionServiceOption[]
> {
  const services = await prisma.service.findMany({
    where: promotionServiceOptionsWhere,
    orderBy: [{ sortOrder: "asc" }, { publicName: "asc" }],
    select: { id: true, publicName: true, isActive: true },
  });

  return services.map((service) => ({
    id: service.id,
    publicName: service.publicName,
    isActive: service.isActive,
    unavailableReason: null,
  }));
}

/**
 * Опции для формы: активный каталог + уже выбранные (даже неактивные) с пометкой.
 */
export async function listPromotionServiceOptionsForEdit(
  selectedServiceIds: string[],
): Promise<PromotionServiceOption[]> {
  const active = await listPromotionServiceOptions();
  const activeIds = new Set(active.map((item) => item.id));
  const missingIds = selectedServiceIds.filter((id) => !activeIds.has(id));
  if (missingIds.length === 0) {
    return active;
  }

  const extras = await prisma.service.findMany({
    where: { id: { in: missingIds } },
    select: { id: true, publicName: true, isActive: true, internalName: true },
  });

  const extraOptions: PromotionServiceOption[] = extras.map((service) => ({
    id: service.id,
    publicName: service.publicName,
    isActive: service.isActive,
    unavailableReason: !service.isActive
      ? "услуга неактивна"
      : service.internalName.toLowerCase().includes("(тест)")
        ? "тестовая услуга"
        : "недоступна для новых привязок",
  }));

  return [...active, ...extraOptions];
}

export async function listPromotionsForAdmin(): Promise<PromotionDto[]> {
  await prisma.promotion.updateMany({
    where: { status: "ARCHIVED", isActive: true },
    data: { isActive: false },
  });

  const rows = await prisma.promotion.findMany({
    include: promotionInclude,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  return rows.map(mapPromotion);
}

export async function getPromotionById(id: string): Promise<PromotionDto> {
  const row = await prisma.promotion.findUnique({
    where: { id },
    include: promotionInclude,
  });
  if (!row) {
    throw new PromotionNotFoundError();
  }
  return mapPromotion(row);
}

export async function createPromotion(
  input: PromotionWriteInput,
): Promise<PromotionDto> {
  const title = input.title?.trim();
  if (!title) {
    throw new PromotionValidationError("Название акции обязательно");
  }

  const slug =
    normalizeSlug(input.slug?.trim() || slugifyPromotionTitle(title)) ||
    slugifyPromotionTitle(title);
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    throw new PromotionValidationError("Slug обязателен");
  }
  await assertUniqueSlug(normalizedSlug);

  const type = input.type ?? "gift";
  let status = input.status ?? "draft";
  const source = input.source ?? "manual";
  let isActive = input.isActive ?? false;

  if (status === "archived" && isActive) {
    throw new PromotionValidationError(
      "Архивная акция не может быть активной",
    );
  }
  if (isActive && status === "draft") {
    status = "active";
  }
  if (!isActive && status === "active") {
    status = "draft";
  }

  validateDiscountCombination(input.discountValue, input.discountUnit);

  const ctaLink = resolveCtaLinkForWrite({
    ...input,
    ctaLink: input.ctaLink ?? null,
  });
  const ctaText = input.ctaText?.trim() || null;
  const showOnHomepage = input.showOnHomepage ?? false;
  assertHomepageRequirements({
    showOnHomepage,
    ctaText,
    ctaLink: ctaLink ?? null,
  });

  const createdId = await prisma.$transaction(async (tx) => {
    let serviceIds: string[] = [];
    try {
      serviceIds = await validateNewPromotionServiceIds(
        tx,
        input.serviceIds ?? [],
      );
    } catch (error) {
      wrapSyncError(error);
    }

    const row = await tx.promotion.create({
      data: {
        title,
        slug: normalizedSlug,
        shortDescription: input.shortDescription?.trim() || null,
        description: input.description?.trim() || null,
        type: promotionTypeToDb(type),
        status: promotionStatusToDb(status),
        isActive,
        startsAt: parseOptionalDate(input.startsAt, "дата начала") ?? null,
        endsAt: parseOptionalDate(input.endsAt, "дата окончания") ?? null,
        giftTitle: input.giftTitle?.trim() || null,
        giftDescription: input.giftDescription?.trim() || null,
        discountValue: parseDiscountValue(input.discountValue) ?? null,
        discountUnit:
          input.discountUnit != null
            ? discountUnitToDb(input.discountUnit)
            : null,
        discountDescription: input.discountDescription?.trim() || null,
        conditions: input.conditions?.trim() || null,
        ctaText,
        ctaLink: ctaLink ?? null,
        imageUrl: input.imageUrl?.trim() || null,
        priority:
          input.priority !== undefined ? Math.round(input.priority) : 100,
        source: promotionSourceToDb(source),
        showOnHomepage,
      },
      select: { id: true },
    });

    if (serviceIds.length > 0) {
      try {
        await syncPromotionServicesInTx(tx, row.id, serviceIds);
      } catch (error) {
        wrapSyncError(error);
      }
    }

    return row.id;
  });

  return getPromotionById(createdId);
}

export async function restorePromotionFromArchive(
  id: string,
): Promise<PromotionDto> {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    throw new PromotionNotFoundError();
  }
  if (existing.status !== "ARCHIVED") {
    throw new PromotionValidationError("Акция не находится в архиве");
  }

  await prisma.promotion.update({
    where: { id },
    data: {
      status: "DRAFT",
      isActive: false,
    },
  });

  return getPromotionById(id);
}

export async function updatePromotion(
  id: string,
  input: PromotionWriteInput,
): Promise<PromotionDto> {
  if (input.restoreFromArchive) {
    const restored = await restorePromotionFromArchive(id);
    if (Object.keys(input).length === 1) {
      return restored;
    }
    const { restoreFromArchive: _, ...rest } = input;
    if (Object.keys(rest).length === 0) {
      return restored;
    }
    return updatePromotion(id, rest);
  }

  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    throw new PromotionNotFoundError();
  }

  if (existing.status === "ARCHIVED" && input.isActive === true) {
    throw new PromotionValidationError(
      "Нельзя включить архивную акцию. Сначала верните её из архива.",
    );
  }

  const data = buildWriteData(input);

  if (existing.status !== "ARCHIVED" && input.isActive !== undefined) {
    if (input.isActive) {
      data.status = "ACTIVE";
      data.isActive = true;
    } else {
      data.status = "DRAFT";
      data.isActive = false;
    }
  }

  if (input.status === "archived") {
    data.status = "ARCHIVED";
    data.isActive = false;
  }

  if (
    existing.status === "ARCHIVED" &&
    input.status &&
    input.status !== "archived"
  ) {
    throw new PromotionValidationError(
      "Чтобы изменить статус архивной акции, сначала верните её из архива.",
    );
  }

  const nextStatus =
    typeof data.status === "string" ? data.status : existing.status;
  const nextIsActive =
    typeof data.isActive === "boolean" ? data.isActive : existing.isActive;

  if (nextStatus === "ARCHIVED" && nextIsActive) {
    throw new PromotionValidationError(
      "Архивная акция не может быть активной",
    );
  }

  if (data.slug && typeof data.slug === "string") {
    await assertUniqueSlug(data.slug, id);
  }

  const nextShowOnHomepage =
    typeof data.showOnHomepage === "boolean"
      ? data.showOnHomepage
      : existing.showOnHomepage;
  const nextCtaText =
    input.ctaText !== undefined
      ? input.ctaText?.trim() || null
      : existing.ctaText;
  const nextCtaLink =
    input.ctaLink !== undefined
      ? (resolveCtaLinkForWrite(input) ?? null)
      : existing.ctaLink;

  assertHomepageRequirements({
    showOnHomepage: nextShowOnHomepage,
    ctaText: nextCtaText,
    ctaLink: nextCtaLink,
  });

  await prisma.$transaction(async (tx) => {
    await tx.promotion.update({
      where: { id },
      data,
    });

    if (input.serviceIds !== undefined) {
      try {
        await syncPromotionServicesInTx(tx, id, input.serviceIds);
      } catch (error) {
        wrapSyncError(error);
      }
    }
  });

  return getPromotionById(id);
}

export async function archivePromotion(id: string): Promise<PromotionDto> {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    throw new PromotionNotFoundError();
  }

  await prisma.promotion.update({
    where: { id },
    data: {
      status: "ARCHIVED",
      isActive: false,
    },
  });

  return getPromotionById(id);
}

export async function listActivePromotions(): Promise<PromotionDto[]> {
  const now = getStudioNow();

  const rows = await prisma.promotion.findMany({
    where: {
      status: "ACTIVE",
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    include: promotionInclude,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  return rows.map(mapPromotion);
}

export async function listHomepagePromotions(): Promise<PromotionDto[]> {
  const now = getStudioNow();

  const rows = await prisma.promotion.findMany({
    where: {
      showOnHomepage: true,
      status: "ACTIVE",
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    include: promotionInclude,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  return rows.map(mapPromotion);
}

export function isPromotionTypeDto(value: string): value is PromotionTypeDto {
  return [
    "gift",
    "seasonal",
    "game",
    "bundle",
    "consultation",
    "custom",
    "discount",
  ].includes(value);
}

export function isPromotionStatusDto(
  value: string,
): value is PromotionStatusDto {
  return ["draft", "active", "archived"].includes(value);
}

export function isPromotionSourceDto(
  value: string,
): value is PromotionSourceDto {
  return ["manual", "game", "vk", "bot", "seasonal"].includes(value);
}
