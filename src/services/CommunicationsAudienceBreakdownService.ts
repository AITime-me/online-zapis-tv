import "server-only";

import { prisma } from "@/lib/db";
import { isEligibleForPromotionalBroadcast } from "@/lib/communications/eligibility";
import {
  buildSegmentWhere,
  type CommSegmentDefinition,
} from "@/lib/communications/segments";
import { getSegmentById } from "@/services/CommunicationsSegmentService";

export type AudienceBreakdown = {
  segmentTotal: number;
  eligible: number;
  excluded: number;
  exclusionReasons: Array<{ reason: string; label: string; count: number }>;
};

const REASON_LABELS: Record<string, string> = {
  suppression: "В списке исключений",
  unsubscribed: "Отписались",
  blocked: "Заблокировали сообщения",
  denied: "Отправка запрещена",
  consent_revoked: "Согласие отозвано",
  consent_not_confirmed: "Нет подтверждённого согласия",
  delivery_not_allowed: "Нет технического разрешения",
};

export async function getSegmentAudienceBreakdown(
  segmentId: string,
): Promise<AudienceBreakdown> {
  const segment = await getSegmentById(segmentId);
  if (!segment) {
    return {
      segmentTotal: 0,
      eligible: 0,
      excluded: 0,
      exclusionReasons: [],
    };
  }

  const definition = segment.definition as CommSegmentDefinition;
  const where = buildSegmentWhere(definition);
  const contacts = await prisma.communicationContact.findMany({
    where,
    select: {
      channel: true,
      communityId: true,
      channelUserId: true,
      deliveryStatus: true,
      consentStatus: true,
      isUnsubscribed: true,
    },
  });

  const suppressions = await prisma.communicationSuppression.findMany({
    where: {
      OR: contacts.map((c) => ({
        channel: c.channel,
        communityId: c.communityId,
        channelUserId: c.channelUserId,
      })),
    },
    select: { channel: true, communityId: true, channelUserId: true },
  });
  const suppressed = new Set(
    suppressions.map((s) => `${s.channel}:${s.communityId}:${s.channelUserId}`),
  );

  const reasonCounts = new Map<string, number>();
  let eligible = 0;

  for (const contact of contacts) {
    const key = `${contact.channel}:${contact.communityId}:${contact.channelUserId}`;
    const isSuppressed = suppressed.has(key);
    const ok = isEligibleForPromotionalBroadcast({
      deliveryStatus: contact.deliveryStatus,
      consentStatus: contact.consentStatus,
      isUnsubscribed: contact.isUnsubscribed,
      suppressed: isSuppressed,
    });
    if (ok) {
      eligible += 1;
      continue;
    }
    let reason = "delivery_not_allowed";
    if (isSuppressed) reason = "suppression";
    else if (contact.isUnsubscribed) reason = "unsubscribed";
    else if (contact.deliveryStatus === "BLOCKED") reason = "blocked";
    else if (contact.deliveryStatus === "DENIED") reason = "denied";
    else if (contact.consentStatus === "REVOKED") reason = "consent_revoked";
    else if (contact.consentStatus !== "CONFIRMED") reason = "consent_not_confirmed";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  const exclusionReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({
      reason,
      label: REASON_LABELS[reason] ?? reason,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    segmentTotal: contacts.length,
    eligible,
    excluded: contacts.length - eligible,
    exclusionReasons,
  };
}

/**
 * Повторная проверка перед будущей отправкой (для worker): suppression сильнее.
 */
export function wouldSendToContact(input: {
  deliveryStatus: "UNKNOWN" | "ALLOWED" | "DENIED" | "BLOCKED";
  consentStatus: "UNKNOWN" | "CONFIRMED" | "REVOKED";
  isUnsubscribed: boolean;
  suppressed: boolean;
}): boolean {
  return isEligibleForPromotionalBroadcast(input);
}
