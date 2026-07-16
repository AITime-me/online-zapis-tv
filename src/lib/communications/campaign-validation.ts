import type { CommButtonType, CommSendMode } from "@prisma/client";
import {
  COMM_MESSAGE_MAX_LENGTH,
  DEFAULT_UNSUBSCRIBE_BUTTON_TEXT,
  VK_MAX_MESSAGE_BUTTONS,
} from "@/lib/communications/composer-labels";
import { isSafeCommCtaLink } from "@/lib/communications/cta-link-policy";
import { getCommunicationDeliveryProvider } from "@/lib/communications/delivery-provider";
import { resolveCommunicationsConnectorState } from "@/lib/communications/connector";

export type CampaignValidationIssue = {
  code: string;
  message: string;
  blocksReady: boolean;
  blocksLaunch: boolean;
};

export type CampaignValidationInput = {
  name: string;
  messageText: string;
  segmentId: string | null;
  mediaAssetId: string | null;
  imageUrl: string | null;
  sendMode: CommSendMode | "UNSPECIFIED" | "NOW" | "SCHEDULED";
  scheduledAt: Date | null;
  eligibleCount: number;
  buttons: Array<{
    text: string;
    type: CommButtonType | string;
    action?: string | null;
    url?: string | null;
  }>;
  callbackSupported?: boolean;
};

export function validateCampaignForComposer(
  input: CampaignValidationInput,
): {
  issues: CampaignValidationIssue[];
  canSaveDraft: boolean;
  canMarkReady: boolean;
  canLaunch: boolean;
  canTestSend: boolean;
} {
  const issues: CampaignValidationIssue[] = [];
  const connector = resolveCommunicationsConnectorState();
  const provider = getCommunicationDeliveryProvider();
  const readiness = provider.getReadiness();

  if (!input.name.trim()) {
    issues.push({
      code: "NAME_REQUIRED",
      message: "Укажите название рассылки",
      blocksReady: true,
      blocksLaunch: true,
    });
  }

  if (!input.messageText.trim()) {
    issues.push({
      code: "TEXT_REQUIRED",
      message: "Напишите текст сообщения",
      blocksReady: true,
      blocksLaunch: true,
    });
  } else if (input.messageText.length > COMM_MESSAGE_MAX_LENGTH) {
    issues.push({
      code: "TEXT_TOO_LONG",
      message: `Текст слишком длинный (максимум ${COMM_MESSAGE_MAX_LENGTH} символов)`,
      blocksReady: true,
      blocksLaunch: true,
    });
  }

  if (!input.segmentId) {
    issues.push({
      code: "SEGMENT_REQUIRED",
      message: "Выберите, кому отправить",
      blocksReady: true,
      blocksLaunch: true,
    });
  }

  if (!input.mediaAssetId && !input.imageUrl) {
    issues.push({
      code: "IMAGE_REQUIRED",
      message: "Добавьте изображение",
      blocksReady: true,
      blocksLaunch: true,
    });
  }

  if (input.buttons.length > VK_MAX_MESSAGE_BUTTONS) {
    issues.push({
      code: "TOO_MANY_BUTTONS",
      message: `Слишком много кнопок (максимум ${VK_MAX_MESSAGE_BUTTONS})`,
      blocksReady: true,
      blocksLaunch: true,
    });
  }

  for (const [index, button] of input.buttons.entries()) {
    if (!button.text.trim()) {
      issues.push({
        code: `BUTTON_TEXT_${index}`,
        message: `У кнопки ${index + 1} нет надписи`,
        blocksReady: true,
        blocksLaunch: true,
      });
    }
    if (button.type === "OPEN_LINK") {
      if (!button.url || !isSafeCommCtaLink(button.url)) {
        issues.push({
          code: `BUTTON_URL_${index}`,
          message: `У кнопки «${button.text || index + 1}» небезопасная или пустая ссылка`,
          blocksReady: true,
          blocksLaunch: true,
        });
      }
    }
    if (button.type === "REPLY_TEXT" && !button.action?.trim()) {
      issues.push({
        code: `BUTTON_REPLY_${index}`,
        message: `Укажите текст ответа для кнопки «${button.text || index + 1}»`,
        blocksReady: true,
        blocksLaunch: true,
      });
    }
    if (button.type === "CALLBACK" && !input.callbackSupported) {
      issues.push({
        code: `BUTTON_CALLBACK_${index}`,
        message:
          "Кнопка «Передать действие боту» нельзя использовать для запуска, пока бот не подключён",
        blocksReady: true,
        blocksLaunch: true,
      });
    }
    if (
      button.type === "UNSUBSCRIBE" &&
      !button.text.trim()
    ) {
      issues.push({
        code: `BUTTON_UNSUB_${index}`,
        message: `Подпись кнопки отписки по умолчанию: ${DEFAULT_UNSUBSCRIBE_BUTTON_TEXT}`,
        blocksReady: true,
        blocksLaunch: true,
      });
    }
  }

  if (input.sendMode === "SCHEDULED") {
    if (!input.scheduledAt) {
      issues.push({
        code: "SCHEDULE_REQUIRED",
        message: "Укажите дату и время отправки",
        blocksReady: true,
        blocksLaunch: true,
      });
    } else if (input.scheduledAt.getTime() < Date.now() - 60_000) {
      issues.push({
        code: "SCHEDULE_PAST",
        message: "Нельзя запланировать рассылку на прошедшее время",
        blocksReady: true,
        blocksLaunch: true,
      });
    }
  }

  if (input.eligibleCount <= 0 && input.segmentId) {
    issues.push({
      code: "NO_ELIGIBLE",
      message: "Нет получателей, которым можно отправить рекламную рассылку",
      blocksReady: true,
      blocksLaunch: true,
    });
  }

  if (!connector.vkConnectorReady || !readiness.ready) {
    issues.push({
      code: "VK_NOT_READY",
      message: readiness.reason,
      blocksReady: false,
      blocksLaunch: true,
    });
  }

  const blocksReady = issues.some((issue) => issue.blocksReady);
  const blocksLaunch = issues.some((issue) => issue.blocksLaunch);

  return {
    issues,
    canSaveDraft: Boolean(input.name.trim()),
    canMarkReady: !blocksReady,
    canLaunch: !blocksLaunch && connector.canRun && readiness.ready,
    canTestSend: connector.vkConnectorReady && readiness.supportsTestSend,
  };
}
