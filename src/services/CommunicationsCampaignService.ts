import "server-only";

import type {
  CommButtonStyle,
  CommButtonType,
  CommCampaignStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assertCanTransitionCampaignStatus,
  resolveCommunicationsConnectorState,
  COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
} from "@/lib/communications/connector";
import { assertSafeCommCtaLink } from "@/lib/communications/cta-link-policy";
import {
  countSegmentAudience,
  ensureSystemSegments,
  getSegmentById,
} from "@/services/CommunicationsSegmentService";
import type { CommSegmentDefinition } from "@/lib/communications/segments";
import type {
  CommCampaignButtonInput,
  CommCampaignDto,
  CommCampaignPreview,
} from "@/types/communications";

export class CommunicationsCampaignValidationError extends Error {}

const ALLOWED_WRITE_STATUSES: CommCampaignStatus[] = ["DRAFT", "READY"];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `campaign-${Date.now()}`;
}

function requireNonEmpty(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new CommunicationsCampaignValidationError(`Заполните поле «${label}»`);
  }
  return trimmed;
}

function normalizeButtons(
  buttons: CommCampaignButtonInput[] | undefined,
): Array<{
  text: string;
  type: CommButtonType;
  buttonKey: string;
  action: string | null;
  url: string | null;
  promotionId: string | null;
  sortOrder: number;
  style: CommButtonStyle;
}> {
  if (!buttons?.length) {
    return [];
  }
  if (buttons.length > 12) {
    throw new CommunicationsCampaignValidationError("Слишком много кнопок (лимит 12)");
  }

  const keys = new Set<string>();
  return buttons.map((button, index) => {
    const text = requireNonEmpty(button.text, "Текст кнопки");
    const buttonKey = requireNonEmpty(button.buttonKey, "Ключ кнопки");
    if (keys.has(buttonKey)) {
      throw new CommunicationsCampaignValidationError(
        `Дублируется buttonKey: ${buttonKey}`,
      );
    }
    keys.add(buttonKey);

    const type = button.type;
    if (!["REPLY_TEXT", "CALLBACK", "OPEN_LINK", "UNSUBSCRIBE"].includes(type)) {
      throw new CommunicationsCampaignValidationError("Неизвестный тип кнопки");
    }

    let url: string | null = null;
    if (type === "OPEN_LINK") {
      url = assertSafeCommCtaLink(button.url);
      if (!url) {
        throw new CommunicationsCampaignValidationError(
          "Для OPEN_LINK нужна безопасная ссылка",
        );
      }
    } else if (button.url) {
      url = assertSafeCommCtaLink(button.url);
    }

    const style = (button.style ?? "SECONDARY") as CommButtonStyle;
    if (!["PRIMARY", "POSITIVE", "NEGATIVE", "SECONDARY"].includes(style)) {
      throw new CommunicationsCampaignValidationError("Неизвестный стиль кнопки VK");
    }

    return {
      text,
      type,
      buttonKey,
      action: button.action?.trim() || null,
      url,
      promotionId: button.promotionId?.trim() || null,
      sortOrder: button.sortOrder ?? index,
      style,
    };
  });
}

function mapCampaign(
  row: {
    id: string;
    name: string;
    slug: string;
    status: CommCampaignStatus;
    segmentId: string | null;
    messageText: string;
    imageUrl: string | null;
    scheduledAt: Date | null;
    attributionWindowHours: number;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string | null;
    stats: unknown;
    createdAt: Date;
    updatedAt: Date;
    segment: { key: string; name: string } | null;
    buttons: Array<{
      id: string;
      text: string;
      type: CommButtonType;
      buttonKey: string;
      action: string | null;
      url: string | null;
      promotionId: string | null;
      sortOrder: number;
      style: CommButtonStyle;
    }>;
  },
  audienceEstimate: number | null,
): CommCampaignDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    segmentId: row.segmentId,
    segmentKey: row.segment?.key ?? null,
    segmentName: row.segment?.name ?? null,
    messageText: row.messageText,
    imageUrl: row.imageUrl,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    attributionWindowHours: row.attributionWindowHours,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    buttons: row.buttons
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((button) => ({
        id: button.id,
        text: button.text,
        type: button.type,
        buttonKey: button.buttonKey,
        action: button.action,
        url: button.url,
        promotionId: button.promotionId,
        sortOrder: button.sortOrder,
        style: button.style,
      })),
    audienceEstimate,
    stats: row.stats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const campaignInclude = {
  segment: { select: { key: true, name: true } },
  buttons: true,
} satisfies Prisma.CommunicationCampaignInclude;

export async function listCampaigns(): Promise<CommCampaignDto[]> {
  await ensureSystemSegments();
  const rows = await prisma.communicationCampaign.findMany({
    include: campaignInclude,
    orderBy: { updatedAt: "desc" },
  });

  const result: CommCampaignDto[] = [];
  for (const row of rows) {
    let estimate: number | null = null;
    if (row.segmentId) {
      const segment = await getSegmentById(row.segmentId);
      if (segment) {
        estimate = await countSegmentAudience(
          segment.definition as CommSegmentDefinition,
        );
      }
    }
    result.push(mapCampaign(row, estimate));
  }
  return result;
}

export async function getCampaign(id: string): Promise<CommCampaignDto | null> {
  const row = await prisma.communicationCampaign.findUnique({
    where: { id },
    include: campaignInclude,
  });
  if (!row) {
    return null;
  }
  let estimate: number | null = null;
  if (row.segmentId) {
    const segment = await getSegmentById(row.segmentId);
    if (segment) {
      estimate = await countSegmentAudience(
        segment.definition as CommSegmentDefinition,
      );
    }
  }
  return mapCampaign(row, estimate);
}

export async function createCampaign(input: {
  name: string;
  slug?: string | null;
  segmentId?: string | null;
  messageText?: string;
  imageUrl?: string | null;
  attributionWindowHours?: number;
  buttons?: CommCampaignButtonInput[];
  userId?: string | null;
}): Promise<CommCampaignDto> {
  await ensureSystemSegments();
  const name = requireNonEmpty(input.name, "Название");
  const slug = slugify(input.slug?.trim() || name);
  const buttons = normalizeButtons(input.buttons);
  const connector = resolveCommunicationsConnectorState();

  const existingSlug = await prisma.communicationCampaign.findUnique({
    where: { slug },
  });
  if (existingSlug) {
    throw new CommunicationsCampaignValidationError(
      "Кампания с таким slug уже существует",
    );
  }

  if (input.segmentId) {
    const segment = await getSegmentById(input.segmentId);
    if (!segment) {
      throw new CommunicationsCampaignValidationError("Сегмент не найден");
    }
  }

  const imageUrl = input.imageUrl?.trim() || null;
  if (imageUrl) {
    assertSafeCommCtaLink(imageUrl);
  }

  const attributionWindowHours = input.attributionWindowHours ?? 72;
  if (attributionWindowHours < 1 || attributionWindowHours > 24 * 30) {
    throw new CommunicationsCampaignValidationError(
      "Окно атрибуции должно быть от 1 до 720 часов",
    );
  }

  void connector;

  const created = await prisma.$transaction(async (tx) => {
    const campaign = await tx.communicationCampaign.create({
      data: {
        name,
        slug,
        status: "DRAFT",
        segmentId: input.segmentId ?? null,
        messageText: input.messageText?.trim() ?? "",
        imageUrl,
        attributionWindowHours,
        utmSource: "vk",
        utmMedium: "messenger",
        utmCampaign: slug,
        createdByUserId: input.userId ?? null,
        updatedByUserId: input.userId ?? null,
        buttons: {
          create: buttons,
        },
      },
      include: campaignInclude,
    });
    return campaign;
  });

  return mapCampaign(created, null);
}

export async function updateCampaign(
  id: string,
  input: {
    name?: string;
    slug?: string;
    status?: CommCampaignStatus;
    segmentId?: string | null;
    messageText?: string;
    imageUrl?: string | null;
    scheduledAt?: string | null;
    attributionWindowHours?: number;
    buttons?: CommCampaignButtonInput[];
    userId?: string | null;
  },
): Promise<CommCampaignDto> {
  const existing = await prisma.communicationCampaign.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new CommunicationsCampaignValidationError("Рассылка не найдена");
  }

  const connector = resolveCommunicationsConnectorState();
  const nextStatus = input.status ?? existing.status;

  if (!ALLOWED_WRITE_STATUSES.includes(nextStatus)) {
    assertCanTransitionCampaignStatus(nextStatus, connector);
    throw new CommunicationsCampaignValidationError(
      "На этом этапе разрешены только статусы DRAFT и READY",
    );
  }

  if (nextStatus === "SCHEDULED" || nextStatus === "RUNNING") {
    assertCanTransitionCampaignStatus(nextStatus, connector);
  }

  if (input.segmentId) {
    const segment = await getSegmentById(input.segmentId);
    if (!segment) {
      throw new CommunicationsCampaignValidationError("Сегмент не найден");
    }
  }

  const buttons =
    input.buttons !== undefined ? normalizeButtons(input.buttons) : null;

  let imageUrl = existing.imageUrl;
  if (input.imageUrl !== undefined) {
    imageUrl = input.imageUrl?.trim() || null;
    if (imageUrl) {
      assertSafeCommCtaLink(imageUrl);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (buttons) {
      await tx.communicationCampaignButton.deleteMany({
        where: { campaignId: id },
      });
      await tx.communicationCampaignButton.createMany({
        data: buttons.map((button) => ({ ...button, campaignId: id })),
      });
    }

    return tx.communicationCampaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined
          ? { name: requireNonEmpty(input.name, "Название") }
          : {}),
        ...(input.slug !== undefined ? { slug: slugify(input.slug) } : {}),
        status: nextStatus,
        ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
        ...(input.messageText !== undefined
          ? { messageText: input.messageText }
          : {}),
        imageUrl,
        ...(input.scheduledAt !== undefined
          ? {
              scheduledAt: input.scheduledAt
                ? new Date(input.scheduledAt)
                : null,
            }
          : {}),
        ...(input.attributionWindowHours !== undefined
          ? { attributionWindowHours: input.attributionWindowHours }
          : {}),
        ...(input.slug !== undefined || input.name !== undefined
          ? {
              utmCampaign: slugify(
                input.slug ?? input.name ?? existing.slug,
              ),
            }
          : {}),
        updatedByUserId: input.userId ?? null,
      },
      include: campaignInclude,
    });
  });

  let estimate: number | null = null;
  if (updated.segmentId) {
    const segment = await getSegmentById(updated.segmentId);
    if (segment) {
      estimate = await countSegmentAudience(
        segment.definition as CommSegmentDefinition,
      );
    }
  }

  return mapCampaign(updated, estimate);
}

export async function previewCampaign(id: string): Promise<CommCampaignPreview> {
  const campaign = await getCampaign(id);
  if (!campaign) {
    throw new CommunicationsCampaignValidationError("Рассылка не найдена");
  }

  let audienceEstimate = 0;
  if (campaign.segmentId) {
    const segment = await getSegmentById(campaign.segmentId);
    if (segment) {
      audienceEstimate = await countSegmentAudience(
        segment.definition as CommSegmentDefinition,
      );
    }
  }

  return {
    messageText: campaign.messageText,
    buttons: campaign.buttons,
    imageUrl: campaign.imageUrl,
    audienceEstimate,
    connectorMessage: COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
    canSend: false,
  };
}

export async function markCampaignReady(id: string, userId?: string | null) {
  return updateCampaign(id, { status: "READY", userId });
}
