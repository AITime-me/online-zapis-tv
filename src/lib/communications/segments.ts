import type { Prisma } from "@prisma/client";

export type CommSegmentDefinition = {
  channel?: "VK";
  requireEligible?: boolean;
  sources?: Array<"SALEBOT_IMPORT" | "VK_WEBHOOK" | "MANUAL">;
  linkedToClient?: boolean | null;
  tagsAny?: string[];
  repliedToPreviousCampaign?: boolean;
  excludedOnly?: boolean;
  maxAgeDays?: number | null;
};

export type SystemSegmentSeed = {
  key: string;
  name: string;
  description: string;
  definition: CommSegmentDefinition;
};

export const SYSTEM_COMMUNICATION_SEGMENTS: SystemSegmentSeed[] = [
  {
    key: "vk_available_all",
    name: "Вся доступная VK-аудитория",
    description:
      "Контакты VK, которые проходят проверку допуска к рекламной рассылке.",
    definition: {
      channel: "VK",
      requireEligible: true,
    },
  },
  {
    key: "new_leads",
    name: "Новые лиды",
    description:
      "Контакты без связи с CRM-клиентом (лиды из переписки сообщества).",
    definition: {
      channel: "VK",
      linkedToClient: false,
      requireEligible: false,
    },
  },
  {
    key: "linked_to_client",
    name: "Связанные с Client",
    description: "Контакты с необязательной связью на карточку CRM.",
    definition: {
      channel: "VK",
      linkedToClient: true,
    },
  },
  {
    key: "promo_interest",
    name: "Интерес к акции",
    description: "Контакты с тегом интереса к акциям студии.",
    definition: {
      channel: "VK",
      tagsAny: ["promo_interest"],
    },
  },
  {
    key: "cold_plasma_interest",
    name: "Интерес к холодной плазме",
    description:
      "Контакты с тегом интереса к холодной плазме. Рассылка только рассказывает об акции — правило скидки 30% не меняется.",
    definition: {
      channel: "VK",
      tagsAny: ["cold_plasma_interest"],
    },
  },
  {
    key: "replied_to_previous",
    name: "Ответившие на предыдущую рассылку",
    description:
      "Контакты с событием ответа в рамках прошлых кампаний (пересчёт при запуске).",
    definition: {
      channel: "VK",
      repliedToPreviousCampaign: true,
    },
  },
  {
    key: "excluded",
    name: "Исключённые из рассылок",
    description:
      "Отписавшиеся, заблокированные, с отозванным согласием или в suppression-реестре.",
    definition: {
      channel: "VK",
      excludedOnly: true,
    },
  },
];

export function buildSegmentWhere(
  definition: CommSegmentDefinition,
): Prisma.CommunicationContactWhereInput {
  const where: Prisma.CommunicationContactWhereInput = {};

  if (definition.channel) {
    where.channel = definition.channel;
  }

  if (definition.sources?.length) {
    where.source = { in: definition.sources };
  }

  if (definition.linkedToClient === true) {
    where.clientId = { not: null };
  } else if (definition.linkedToClient === false) {
    where.clientId = null;
  }

  if (definition.tagsAny?.length) {
    where.tags = { hasSome: definition.tagsAny };
  }

  if (definition.maxAgeDays != null && definition.maxAgeDays > 0) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - definition.maxAgeDays);
    where.createdAt = { gte: since };
  }

  if (definition.excludedOnly) {
    where.OR = [
      { isUnsubscribed: true },
      { deliveryStatus: { in: ["DENIED", "BLOCKED"] } },
      { consentStatus: "REVOKED" },
      { exclusionReason: { not: null } },
    ];
    return where;
  }

  if (definition.requireEligible) {
    where.isUnsubscribed = false;
    where.deliveryStatus = "ALLOWED";
    where.consentStatus = "CONFIRMED";
  }

  if (definition.repliedToPreviousCampaign) {
    where.events = {
      some: {
        type: "REPLY_RECEIVED",
      },
    };
  }

  return where;
}
