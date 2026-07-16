import "server-only";

import { prisma } from "@/lib/db";
import { isEligibleForPromotionalBroadcast } from "@/lib/communications/eligibility";
import {
  buildCommContactWhere,
  type ParsedCommContactListQuery,
} from "@/lib/communications/list-query";
import type { CommContactListItem } from "@/types/communications";

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function listCommunicationContacts(
  query: ParsedCommContactListQuery,
): Promise<{
  contacts: CommContactListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const where = buildCommContactWhere(query.filters);
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows, suppressions] = await Promise.all([
    prisma.communicationContact.count({ where }),
    prisma.communicationContact.findMany({
      where,
      orderBy: [{ lastInteractionAt: "desc" }, { createdAt: "desc" }],
      skip,
      take: query.pageSize,
    }),
    prisma.communicationSuppression.findMany({
      select: { channelUserId: true, communityId: true, channel: true },
    }),
  ]);

  const suppressed = new Set(
    suppressions.map(
      (row) => `${row.channel}:${row.communityId}:${row.channelUserId}`,
    ),
  );

  const contacts: CommContactListItem[] = rows.map((row) => {
    const key = `${row.channel}:${row.communityId}:${row.channelUserId}`;
    return {
      id: row.id,
      channel: "VK",
      communityId: row.communityId,
      channelUserId: row.channelUserId,
      displayName: row.displayName,
      clientId: row.clientId,
      source: row.source,
      deliveryStatus: row.deliveryStatus,
      consentStatus: row.consentStatus,
      isUnsubscribed: row.isUnsubscribed,
      exclusionReason: row.exclusionReason,
      tags: row.tags,
      firstInteractionAt: toIso(row.firstInteractionAt),
      lastInteractionAt: toIso(row.lastInteractionAt),
      lastInboundAt: toIso(row.lastInboundAt),
      eligibleForPromo: isEligibleForPromotionalBroadcast({
        deliveryStatus: row.deliveryStatus,
        consentStatus: row.consentStatus,
        isUnsubscribed: row.isUnsubscribed,
        suppressed: suppressed.has(key),
      }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  return {
    contacts,
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
