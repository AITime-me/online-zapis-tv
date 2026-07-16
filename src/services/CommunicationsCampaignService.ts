import "server-only";

import type {
  CommButtonStyle,
  CommButtonType,
  CommCampaignStatus,
  CommSendMode,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assertCanTransitionCampaignStatus,
  resolveCommunicationsConnectorState,
  COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
} from "@/lib/communications/connector";
import { assertSafeCommCtaLink } from "@/lib/communications/cta-link-policy";
import { validateCampaignForComposer } from "@/lib/communications/campaign-validation";
import {
  DEFAULT_ATTRIBUTION_DAYS,
  DEFAULT_UNSUBSCRIBE_BUTTON_TEXT,
  STUDIO_TIMEZONE,
  VK_MAX_MESSAGE_BUTTONS,
} from "@/lib/communications/composer-labels";
import {
  getCommunicationDeliveryProvider,
  VK_CONNECTOR_NOT_READY,
} from "@/lib/communications/delivery-provider";
import {
  appendCampaignUtmParams,
} from "@/lib/communications/cta-link-policy";
import {
  assertNotInPast,
  attributionDaysToHours,
  attributionHoursToDays,
  CommScheduleValidationError,
  parseStudioLocalDateTime,
} from "@/lib/communications/schedule";
import {
  assertNoPiiInTechnicalKey,
  generateButtonKey,
  generateUniqueCampaignSlug,
} from "@/lib/communications/slug-and-keys";
import { getSegmentAudienceBreakdown } from "@/services/CommunicationsAudienceBreakdownService";
import {
  countSegmentAudience,
  ensureSystemSegments,
  getSegmentById,
} from "@/services/CommunicationsSegmentService";
import type { CommSegmentDefinition } from "@/lib/communications/segments";
import type {
  CommCampaignButtonInput,
  CommCampaignCheckResult,
  CommCampaignDto,
  CommCampaignPreview,
} from "@/types/communications";

export class CommunicationsCampaignValidationError extends Error {}

const ALLOWED_WRITE_STATUSES: CommCampaignStatus[] = ["DRAFT", "READY"];

function requireNonEmpty(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new CommunicationsCampaignValidationError(`Заполните поле «${label}»`);
  }
  return trimmed;
}

type NormalizedButton = {
  text: string;
  type: CommButtonType;
  buttonKey: string;
  action: string | null;
  url: string | null;
  promotionId: string | null;
  sortOrder: number;
  style: CommButtonStyle;
};

function normalizeButtons(
  buttons: CommCampaignButtonInput[] | undefined,
  existingButtons?: Array<{ buttonKey: string; text: string; type: CommButtonType }>,
): NormalizedButton[] {
  if (!buttons?.length) {
    return [];
  }
  if (buttons.length > VK_MAX_MESSAGE_BUTTONS) {
    throw new CommunicationsCampaignValidationError(
      `Слишком много кнопок (лимит ${VK_MAX_MESSAGE_BUTTONS})`,
    );
  }

  const existingByStable = new Map(
    (existingButtons ?? []).map((button) => [
      `${button.type}:${button.text}`,
      button.buttonKey,
    ]),
  );
  const usedKeys = new Set<string>();

  return buttons.map((button, index) => {
    const text =
      button.type === "UNSUBSCRIBE"
        ? button.text?.trim() || DEFAULT_UNSUBSCRIBE_BUTTON_TEXT
        : requireNonEmpty(button.text, "Надпись на кнопке");

    const type = button.type as CommButtonType;
    if (!["REPLY_TEXT", "CALLBACK", "OPEN_LINK", "UNSUBSCRIBE"].includes(type)) {
      throw new CommunicationsCampaignValidationError("Неизвестный тип кнопки");
    }

    let buttonKey =
      button.buttonKey?.trim() ||
      existingByStable.get(`${type}:${text}`) ||
      generateButtonKey({
        type,
        text,
        existingKeys: usedKeys,
        index,
      });
    if (usedKeys.has(buttonKey)) {
      buttonKey = generateButtonKey({
        type,
        text,
        existingKeys: usedKeys,
        index,
      });
    }
    assertNoPiiInTechnicalKey(buttonKey);
    usedKeys.add(buttonKey);

    let url: string | null = null;
    if (type === "OPEN_LINK") {
      url = assertSafeCommCtaLink(button.url);
      if (!url) {
        throw new CommunicationsCampaignValidationError(
          "Для кнопки «Открыть страницу» нужна безопасная ссылка",
        );
      }
    } else if (button.url) {
      url = assertSafeCommCtaLink(button.url);
    }

    let action = button.action?.trim() || null;
    if (type === "REPLY_TEXT" && !action) {
      action = text;
    }
    if (type === "UNSUBSCRIBE") {
      action = action || "UNSUBSCRIBE";
    }

    const style = (button.style ??
      (type === "UNSUBSCRIBE"
        ? "NEGATIVE"
        : type === "OPEN_LINK"
          ? "POSITIVE"
          : type === "REPLY_TEXT"
            ? "PRIMARY"
            : "SECONDARY")) as CommButtonStyle;

    if (!["PRIMARY", "POSITIVE", "NEGATIVE", "SECONDARY"].includes(style)) {
      throw new CommunicationsCampaignValidationError("Неизвестный стиль кнопки");
    }

    return {
      text,
      type,
      buttonKey,
      action,
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
    mediaAssetId: string | null;
    sendMode: CommSendMode;
    scheduledAt: Date | null;
    scheduleTimezone: string;
    attributionWindowHours: number;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string | null;
    stats: unknown;
    recipientSnapshotAt: Date | null;
    contentLockedAt: Date | null;
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
    mediaAssetId: row.mediaAssetId,
    mediaPreviewUrl: row.mediaAssetId
      ? `/api/admin/communications/media/${row.mediaAssetId}`
      : null,
    sendMode: row.sendMode,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    scheduleTimezone: row.scheduleTimezone,
    attributionWindowHours: row.attributionWindowHours,
    attributionDays: attributionHoursToDays(row.attributionWindowHours),
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
    recipientSnapshotAt: row.recipientSnapshotAt?.toISOString() ?? null,
    contentLockedAt: row.contentLockedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const campaignInclude = {
  segment: { select: { key: true, name: true } },
  buttons: true,
} satisfies Prisma.CommunicationCampaignInclude;

async function estimateForSegment(segmentId: string | null): Promise<number | null> {
  if (!segmentId) {
    return null;
  }
  const segment = await getSegmentById(segmentId);
  if (!segment) {
    return null;
  }
  return countSegmentAudience(segment.definition as CommSegmentDefinition);
}

export async function listCampaigns(): Promise<CommCampaignDto[]> {
  await ensureSystemSegments();
  const rows = await prisma.communicationCampaign.findMany({
    include: campaignInclude,
    orderBy: { updatedAt: "desc" },
  });
  const result: CommCampaignDto[] = [];
  for (const row of rows) {
    result.push(mapCampaign(row, await estimateForSegment(row.segmentId)));
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
  return mapCampaign(row, await estimateForSegment(row.segmentId));
}

export async function createCampaign(input: {
  name: string;
  segmentId?: string | null;
  messageText?: string;
  mediaAssetId?: string | null;
  sendMode?: CommSendMode;
  scheduledAt?: string | null;
  scheduleDate?: string | null;
  scheduleTime?: string | null;
  attributionDays?: number;
  buttons?: CommCampaignButtonInput[];
  userId?: string | null;
}): Promise<CommCampaignDto> {
  await ensureSystemSegments();
  const name = requireNonEmpty(input.name, "Название рассылки");

  const existing = await prisma.communicationCampaign.findMany({
    select: { slug: true },
  });
  const slug = generateUniqueCampaignSlug(
    name,
    existing.map((row) => row.slug),
  );
  assertNoPiiInTechnicalKey(slug);

  const buttons = normalizeButtons(input.buttons);

  if (input.segmentId) {
    const segment = await getSegmentById(input.segmentId);
    if (!segment) {
      throw new CommunicationsCampaignValidationError("Сегмент не найден");
    }
  }

  if (input.mediaAssetId) {
    const media = await prisma.communicationMediaAsset.findUnique({
      where: { id: input.mediaAssetId },
    });
    if (!media) {
      throw new CommunicationsCampaignValidationError("Изображение не найдено");
    }
  }

  let scheduledAt: Date | null = null;
  const sendMode = input.sendMode ?? "UNSPECIFIED";
  if (sendMode === "SCHEDULED") {
    try {
      if (input.scheduleDate && input.scheduleTime) {
        scheduledAt = parseStudioLocalDateTime({
          date: input.scheduleDate,
          time: input.scheduleTime,
        });
      } else if (input.scheduledAt) {
        scheduledAt = new Date(input.scheduledAt);
      }
      if (scheduledAt) {
        assertNotInPast(scheduledAt);
      }
    } catch (error) {
      if (error instanceof CommScheduleValidationError) {
        throw new CommunicationsCampaignValidationError(error.message);
      }
      throw error;
    }
  }

  let attributionWindowHours = DEFAULT_ATTRIBUTION_DAYS * 24;
  if (input.attributionDays !== undefined) {
    try {
      attributionWindowHours = attributionDaysToHours(input.attributionDays);
    } catch (error) {
      if (error instanceof CommScheduleValidationError) {
        throw new CommunicationsCampaignValidationError(error.message);
      }
      throw error;
    }
  }

  const created = await prisma.communicationCampaign.create({
    data: {
      name,
      slug,
      status: "DRAFT",
      segmentId: input.segmentId ?? null,
      messageText: input.messageText?.trim() ?? "",
      mediaAssetId: input.mediaAssetId ?? null,
      imageUrl: null,
      sendMode,
      scheduledAt,
      scheduleTimezone: STUDIO_TIMEZONE,
      attributionWindowHours,
      utmSource: "vk",
      utmMedium: "messenger",
      utmCampaign: slug,
      createdByUserId: input.userId ?? null,
      updatedByUserId: input.userId ?? null,
      buttons: { create: buttons },
    },
    include: campaignInclude,
  });

  return mapCampaign(created, await estimateForSegment(created.segmentId));
}

export async function updateCampaign(
  id: string,
  input: {
    name?: string;
    status?: CommCampaignStatus;
    segmentId?: string | null;
    messageText?: string;
    mediaAssetId?: string | null;
    clearMedia?: boolean;
    sendMode?: CommSendMode;
    scheduledAt?: string | null;
    scheduleDate?: string | null;
    scheduleTime?: string | null;
    attributionDays?: number;
    buttons?: CommCampaignButtonInput[];
    userId?: string | null;
  },
): Promise<CommCampaignDto> {
  const existing = await prisma.communicationCampaign.findUnique({
    where: { id },
    include: { buttons: true },
  });
  if (!existing) {
    throw new CommunicationsCampaignValidationError("Рассылка не найдена");
  }

  if (existing.recipientSnapshotAt || existing.contentLockedAt) {
    const criticalChange =
      input.messageText !== undefined ||
      input.buttons !== undefined ||
      input.segmentId !== undefined ||
      input.mediaAssetId !== undefined ||
      input.clearMedia;
    if (criticalChange) {
      throw new CommunicationsCampaignValidationError(
        "После фиксации получателей нельзя незаметно менять содержимое рассылки",
      );
    }
  }

  const connector = resolveCommunicationsConnectorState();
  const nextStatus = input.status ?? existing.status;

  if (!ALLOWED_WRITE_STATUSES.includes(nextStatus)) {
    assertCanTransitionCampaignStatus(nextStatus, connector);
    throw new CommunicationsCampaignValidationError(
      "Пока доступны только статусы «Черновик» и «Готова»",
    );
  }

  if (nextStatus === "READY" && existing.status === "DRAFT") {
    const check = await checkCampaign(id);
    if (!check.canMarkReady) {
      throw new CommunicationsCampaignValidationError(
        check.issues.find((i) => i.blocksReady)?.message ||
          "Рассылка не готова к подготовке",
      );
    }
  }

  if (input.segmentId) {
    const segment = await getSegmentById(input.segmentId);
    if (!segment) {
      throw new CommunicationsCampaignValidationError("Сегмент не найден");
    }
  }

  const buttons =
    input.buttons !== undefined
      ? normalizeButtons(input.buttons, existing.buttons)
      : null;

  let mediaAssetId = existing.mediaAssetId;
  if (input.clearMedia) {
    mediaAssetId = null;
  } else if (input.mediaAssetId !== undefined) {
    if (input.mediaAssetId) {
      const media = await prisma.communicationMediaAsset.findUnique({
        where: { id: input.mediaAssetId },
      });
      if (!media) {
        throw new CommunicationsCampaignValidationError("Изображение не найдено");
      }
    }
    mediaAssetId = input.mediaAssetId;
  }

  let scheduledAt = existing.scheduledAt;
  let sendMode = input.sendMode ?? existing.sendMode;
  if (sendMode === "SCHEDULED") {
    try {
      if (input.scheduleDate && input.scheduleTime) {
        scheduledAt = parseStudioLocalDateTime({
          date: input.scheduleDate,
          time: input.scheduleTime,
        });
        assertNotInPast(scheduledAt);
      } else if (input.scheduledAt !== undefined) {
        scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
        if (scheduledAt) {
          assertNotInPast(scheduledAt);
        }
      }
    } catch (error) {
      if (error instanceof CommScheduleValidationError) {
        throw new CommunicationsCampaignValidationError(error.message);
      }
      throw error;
    }
  } else if (sendMode === "NOW") {
    scheduledAt = null;
  }

  let attributionWindowHours = existing.attributionWindowHours;
  if (input.attributionDays !== undefined) {
    try {
      attributionWindowHours = attributionDaysToHours(input.attributionDays);
    } catch (error) {
      if (error instanceof CommScheduleValidationError) {
        throw new CommunicationsCampaignValidationError(error.message);
      }
      throw error;
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
          ? { name: requireNonEmpty(input.name, "Название рассылки") }
          : {}),
        // slug после создания не меняем
        status: nextStatus,
        ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
        ...(input.messageText !== undefined
          ? { messageText: input.messageText }
          : {}),
        mediaAssetId,
        imageUrl: mediaAssetId ? null : existing.imageUrl,
        sendMode,
        scheduledAt,
        scheduleTimezone: STUDIO_TIMEZONE,
        attributionWindowHours,
        updatedByUserId: input.userId ?? null,
      },
      include: campaignInclude,
    });
  });

  return mapCampaign(updated, await estimateForSegment(updated.segmentId));
}

export async function checkCampaign(id: string): Promise<CommCampaignCheckResult> {
  const campaign = await getCampaign(id);
  if (!campaign) {
    throw new CommunicationsCampaignValidationError("Рассылка не найдена");
  }

  const breakdown = campaign.segmentId
    ? await getSegmentAudienceBreakdown(campaign.segmentId)
    : {
        segmentTotal: 0,
        eligible: 0,
        excluded: 0,
        exclusionReasons: [],
      };

  const validation = validateCampaignForComposer({
    name: campaign.name,
    messageText: campaign.messageText,
    segmentId: campaign.segmentId,
    mediaAssetId: campaign.mediaAssetId,
    imageUrl: campaign.imageUrl,
    sendMode: campaign.sendMode,
    scheduledAt: campaign.scheduledAt ? new Date(campaign.scheduledAt) : null,
    eligibleCount: breakdown.eligible,
    buttons: campaign.buttons,
    callbackSupported: false,
  });

  const connector = resolveCommunicationsConnectorState();
  const provider = getCommunicationDeliveryProvider();
  const linksWithUtm = campaign.buttons
    .filter((button) => button.type === "OPEN_LINK" && button.url)
    .map((button) => ({
      buttonText: button.text,
      url: appendCampaignUtmParams(button.url!, {
        campaignSlug: campaign.slug,
        buttonKey: button.buttonKey,
      }),
    }));

  return {
    campaign,
    audience: breakdown,
    issues: validation.issues,
    canSaveDraft: validation.canSaveDraft,
    canMarkReady: validation.canMarkReady,
    canLaunch: false,
    canTestSend: false,
    connector,
    workerReady: false,
    providerReady: provider.getReadiness(),
    linksWithUtm,
    studioTimezoneLabel: "Время студии — Екатеринбург",
  };
}

export async function previewCampaign(id: string): Promise<CommCampaignPreview> {
  const campaign = await getCampaign(id);
  if (!campaign) {
    throw new CommunicationsCampaignValidationError("Рассылка не найдена");
  }
  const breakdown = campaign.segmentId
    ? await getSegmentAudienceBreakdown(campaign.segmentId)
    : null;

  return {
    messageText: campaign.messageText,
    buttons: campaign.buttons,
    imageUrl: campaign.mediaPreviewUrl || campaign.imageUrl,
    mediaAssetId: campaign.mediaAssetId,
    audienceEstimate: breakdown?.eligible ?? campaign.audienceEstimate ?? 0,
    connectorMessage: COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
    canSend: false,
  };
}

export async function markCampaignReady(id: string, userId?: string | null) {
  return updateCampaign(id, { status: "READY", userId });
}

export async function reopenCampaignDraft(id: string, userId?: string | null) {
  return updateCampaign(id, { status: "DRAFT", userId });
}

export async function requestTestSend(input: {
  campaignId: string;
  confirmed: boolean;
  userId?: string | null;
}): Promise<{
  ok: false;
  errorCode: string;
  errorMessage: string;
  attemptId: string;
}> {
  if (!input.confirmed) {
    throw new CommunicationsCampaignValidationError(
      "Подтвердите тестовую отправку",
    );
  }

  const campaign = await getCampaign(input.campaignId);
  if (!campaign) {
    throw new CommunicationsCampaignValidationError("Рассылка не найдена");
  }

  const settings = await prisma.communicationSettings.findUnique({
    where: { id: "default" },
  });
  const testContactId = settings?.testContactId ?? null;
  const provider = getCommunicationDeliveryProvider();
  const result = await provider.sendTestMessage({
    campaignId: campaign.id,
    contactId: testContactId || "missing",
    messageText: campaign.messageText,
    imageAssetId: campaign.mediaAssetId,
    buttons: campaign.buttons,
    isTest: true,
  });

  const attempt = await prisma.communicationDeliveryAttempt.create({
    data: {
      campaignId: campaign.id,
      contactId: testContactId,
      isTest: true,
      status: result.ok ? "ACCEPTED" : "BLOCKED",
      provider: result.provider,
      errorCode: result.ok ? null : result.errorCode,
      externalMessageId: result.ok ? result.externalMessageId : null,
    },
  });

  // Тест не влияет на stats кампании и не меняет статус.
  return {
    ok: false,
    errorCode: result.ok ? "UNEXPECTED" : result.errorCode || VK_CONNECTOR_NOT_READY,
    errorMessage: result.ok
      ? "Неожиданный успех disabled provider"
      : result.errorMessage,
    attemptId: attempt.id,
  };
}

export async function requestLaunch(input: {
  campaignId: string;
  mode: "NOW" | "SCHEDULED";
  confirmed: boolean;
}): Promise<never> {
  if (!input.confirmed) {
    throw new CommunicationsCampaignValidationError("Подтвердите запуск");
  }
  const connector = resolveCommunicationsConnectorState();
  assertCanTransitionCampaignStatus(
    input.mode === "NOW" ? "RUNNING" : "SCHEDULED",
    connector,
  );
  throw new CommunicationsCampaignValidationError(
    "Запуск недоступен: подключите VK и worker отправки",
  );
}
