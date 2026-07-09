import type { ClientDuplicateReviewStatus, Prisma } from "@prisma/client";
import { normalizeClientFullName } from "@/lib/clients/normalize-full-name";
import {
  getPhoneMatchSuffix,
  normalizePhone,
} from "@/lib/phone/normalize-phone";
import { prisma } from "@/lib/db";
import type {
  ClientDuplicateFilters,
  ClientDuplicateGroupDto,
  ClientDuplicateMemberDto,
  ClientDuplicateSummaryDto,
  DuplicateConfidence,
  DuplicateMatchReason,
} from "@/types/client-duplicates";

export class ClientDuplicateValidationError extends Error {}

const clientDuplicateSelect = {
  id: true,
  fullName: true,
  phone: true,
  normalizedPhone: true,
  email: true,
  status: true,
  source: true,
  tags: true,
  isArchived: true,
  lastContactAt: true,
  createdAt: true,
  _count: {
    select: { bookingRequests: true },
  },
} satisfies Prisma.ClientSelect;

type ClientDuplicateRow = Prisma.ClientGetPayload<{
  select: typeof clientDuplicateSelect;
}>;

type DuplicateEdge = {
  a: string;
  b: string;
  confidence: DuplicateConfidence;
  reason: DuplicateMatchReason;
};

const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const REASON_CONFIDENCE: Record<DuplicateMatchReason, DuplicateConfidence> = {
  SAME_NORMALIZED_PHONE: "HIGH",
  SAME_EMAIL: "HIGH",
  SAME_PHONE_SUFFIX: "MEDIUM",
  SAME_NAME_WITH_CONTACT: "MEDIUM",
  SAME_NAME_DIFFERENT_CONTACTS: "LOW",
};

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
    }
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent || parent === id) {
      return id;
    }
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string) {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }
}

export function buildDuplicateFingerprint(clientIds: string[]): string {
  return [...clientIds].sort().join("|");
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function mapClientRow(row: ClientDuplicateRow): ClientDuplicateMemberDto {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    normalizedPhone: row.normalizedPhone,
    email: row.email,
    status: row.status,
    source: row.source,
    tags: row.tags,
    bookingRequestCount: row._count.bookingRequests,
    lastContactAt: row.lastContactAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    isArchived: row.isArchived,
  };
}

function addEdge(
  edges: DuplicateEdge[],
  edgeKeys: Set<string>,
  a: string,
  b: string,
  reason: DuplicateMatchReason,
) {
  if (a === b) {
    return;
  }

  const [left, right] = a < b ? [a, b] : [b, a];
  const key = `${left}|${right}|${reason}`;
  if (edgeKeys.has(key)) {
    return;
  }

  edgeKeys.add(key);
  edges.push({
    a: left,
    b: right,
    confidence: REASON_CONFIDENCE[reason],
    reason,
  });
}

function unionGroupIds(ids: string[], unionFind: UnionFind) {
  if (ids.length < 2) {
    return;
  }

  const [first, ...rest] = ids;
  for (const id of rest) {
    unionFind.union(first, id);
  }
}

function buildDuplicateEdges(clients: ClientDuplicateRow[]): DuplicateEdge[] {
  const edges: DuplicateEdge[] = [];
  const edgeKeys = new Set<string>();
  const unionFind = new UnionFind();

  const byNormalizedPhone = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  const byPhoneSuffix = new Map<string, string[]>();
  const byNormalizedName = new Map<string, string[]>();

  for (const client of clients) {
    unionFind.add(client.id);

    if (client.normalizedPhone) {
      const list = byNormalizedPhone.get(client.normalizedPhone) ?? [];
      list.push(client.id);
      byNormalizedPhone.set(client.normalizedPhone, list);
    }

    const email = normalizeEmail(client.email);
    if (email) {
      const list = byEmail.get(email) ?? [];
      list.push(client.id);
      byEmail.set(email, list);
    }

    const suffix =
      client.normalizedPhone?.slice(-10) ??
      getPhoneMatchSuffix(client.phone)?.slice(-10) ??
      null;
    if (suffix) {
      const list = byPhoneSuffix.get(suffix) ?? [];
      list.push(client.id);
      byPhoneSuffix.set(suffix, list);
    }

    const normalizedName = normalizeClientFullName(client.fullName);
    const nameList = byNormalizedName.get(normalizedName) ?? [];
    nameList.push(client.id);
    byNormalizedName.set(normalizedName, nameList);
  }

  for (const ids of byNormalizedPhone.values()) {
    unionGroupIds(ids, unionFind);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        addEdge(edges, edgeKeys, ids[i], ids[j], "SAME_NORMALIZED_PHONE");
      }
    }
  }

  for (const ids of byEmail.values()) {
    unionGroupIds(ids, unionFind);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        addEdge(edges, edgeKeys, ids[i], ids[j], "SAME_EMAIL");
      }
    }
  }

  for (const [suffix, ids] of byPhoneSuffix.entries()) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length < 2) {
      continue;
    }

    for (let i = 0; i < uniqueIds.length; i += 1) {
      for (let j = i + 1; j < uniqueIds.length; j += 1) {
        const left = clients.find((client) => client.id === uniqueIds[i]);
        const right = clients.find((client) => client.id === uniqueIds[j]);
        if (!left || !right) {
          continue;
        }

        if (
          left.normalizedPhone &&
          right.normalizedPhone &&
          left.normalizedPhone === right.normalizedPhone
        ) {
          continue;
        }

        addEdge(
          edges,
          edgeKeys,
          uniqueIds[i],
          uniqueIds[j],
          "SAME_PHONE_SUFFIX",
        );
      }
    }

    void suffix;
  }

  for (const ids of byNormalizedName.values()) {
    if (ids.length < 2) {
      continue;
    }

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const left = clients.find((client) => client.id === ids[i]);
        const right = clients.find((client) => client.id === ids[j]);
        if (!left || !right) {
          continue;
        }

        const leftEmail = normalizeEmail(left.email);
        const rightEmail = normalizeEmail(right.email);
        const leftSuffix =
          left.normalizedPhone?.slice(-10) ??
          getPhoneMatchSuffix(left.phone)?.slice(-10) ??
          null;
        const rightSuffix =
          right.normalizedPhone?.slice(-10) ??
          getPhoneMatchSuffix(right.phone)?.slice(-10) ??
          null;

        const hasEmailMatch = Boolean(
          leftEmail && rightEmail && leftEmail === rightEmail,
        );
        const hasPhoneSuffixMatch = Boolean(
          leftSuffix && rightSuffix && leftSuffix === rightSuffix,
        );
        const hasNormalizedPhoneMatch = Boolean(
          left.normalizedPhone &&
            right.normalizedPhone &&
            left.normalizedPhone === right.normalizedPhone,
        );

        if (hasEmailMatch || hasNormalizedPhoneMatch) {
          continue;
        }

        if (hasPhoneSuffixMatch) {
          addEdge(
            edges,
            edgeKeys,
            ids[i],
            ids[j],
            "SAME_NAME_WITH_CONTACT",
          );
          unionFind.union(ids[i], ids[j]);
          continue;
        }

        addEdge(
          edges,
          edgeKeys,
          ids[i],
          ids[j],
          "SAME_NAME_DIFFERENT_CONTACTS",
        );
        unionFind.union(ids[i], ids[j]);
      }
    }
  }

  void unionFind;
  return edges;
}

function buildGroupsFromEdges(
  clients: ClientDuplicateRow[],
  edges: DuplicateEdge[],
): ClientDuplicateGroupDto[] {
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const unionFind = new UnionFind();

  for (const client of clients) {
    unionFind.add(client.id);
  }

  for (const edge of edges) {
    unionFind.union(edge.a, edge.b);
  }

  const components = new Map<string, string[]>();
  for (const client of clients) {
    const root = unionFind.find(client.id);
    const list = components.get(root) ?? [];
    list.push(client.id);
    components.set(root, list);
  }

  const groups: ClientDuplicateGroupDto[] = [];

  for (const memberIds of components.values()) {
    if (memberIds.length < 2) {
      continue;
    }

    const sortedIds = [...memberIds].sort();
    const memberSet = new Set(sortedIds);
    const groupEdges = edges.filter(
      (edge) => memberSet.has(edge.a) && memberSet.has(edge.b),
    );

    const reasons = [...new Set(groupEdges.map((edge) => edge.reason))];
    const confidence = reasons.reduce<DuplicateConfidence>(
      (current, reason) => {
        const next = REASON_CONFIDENCE[reason];
        return CONFIDENCE_RANK[next] > CONFIDENCE_RANK[current] ? next : current;
      },
      "LOW",
    );

    const groupClients = sortedIds
      .map((id) => clientMap.get(id))
      .filter((client): client is ClientDuplicateRow => Boolean(client))
      .map(mapClientRow);

    groups.push({
      fingerprint: buildDuplicateFingerprint(sortedIds),
      confidence,
      reasons,
      reviewStatus: "REVIEW",
      note: null,
      clients: groupClients,
    });
  }

  return groups.sort((left, right) => {
    const confidenceDiff =
      CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    return left.clients[0]?.fullName.localeCompare(right.clients[0]?.fullName ?? "", "ru") ?? 0;
  });
}

function matchesSearchQuery(
  group: ClientDuplicateGroupDto,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return group.clients.some((client) => {
    const haystack = [
      client.fullName,
      client.phone ?? "",
      client.normalizedPhone ?? "",
      client.email ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function buildSummary(groups: ClientDuplicateGroupDto[]): ClientDuplicateSummaryDto {
  return {
    totalGroups: groups.length,
    highConfidence: groups.filter((group) => group.confidence === "HIGH").length,
    mediumConfidence: groups.filter((group) => group.confidence === "MEDIUM")
      .length,
    lowConfidence: groups.filter((group) => group.confidence === "LOW").length,
    needsReview: groups.filter((group) => group.reviewStatus === "REVIEW").length,
    postponed: groups.filter((group) => group.reviewStatus === "POSTPONED")
      .length,
    notDuplicate: groups.filter(
      (group) => group.reviewStatus === "NOT_DUPLICATE",
    ).length,
  };
}

export async function listClientDuplicateGroups(
  filters: ClientDuplicateFilters = {},
): Promise<{
  summary: ClientDuplicateSummaryDto;
  groups: ClientDuplicateGroupDto[];
}> {
  const clients = await prisma.client.findMany({
    where: { mergedIntoClientId: null },
    select: clientDuplicateSelect,
    orderBy: { updatedAt: "desc" },
  });

  const edges = buildDuplicateEdges(clients);
  const groups = buildGroupsFromEdges(clients, edges);

  const fingerprints = groups.map((group) => group.fingerprint);
  const reviews =
    fingerprints.length > 0
      ? await prisma.clientDuplicateReview.findMany({
          where: { fingerprint: { in: fingerprints } },
        })
      : [];

  const reviewMap = new Map(reviews.map((review) => [review.fingerprint, review]));

  const enrichedGroups = groups.map((group) => {
    const review = reviewMap.get(group.fingerprint);
    return {
      ...group,
      reviewStatus: review?.status ?? "REVIEW",
      note: review?.note ?? null,
    };
  });

  const confidenceFilter = filters.confidence ?? "all";
  const reviewStatusFilter = filters.reviewStatus ?? "REVIEW";
  const query = filters.q?.trim() ?? "";

  const filteredGroups = enrichedGroups.filter((group) => {
    if (confidenceFilter !== "all" && group.confidence !== confidenceFilter) {
      return false;
    }
    if (
      reviewStatusFilter !== "all" &&
      group.reviewStatus !== reviewStatusFilter
    ) {
      return false;
    }
    if (!matchesSearchQuery(group, query)) {
      return false;
    }
    return true;
  });

  return {
    summary: buildSummary(enrichedGroups),
    groups: filteredGroups,
  };
}

export async function updateClientDuplicateReview(input: {
  fingerprint: string;
  status: ClientDuplicateReviewStatus;
  note?: string | null;
  reviewedByUserId: string;
}): Promise<void> {
  const fingerprint = input.fingerprint.trim();
  if (!fingerprint) {
    throw new ClientDuplicateValidationError("Не указан fingerprint группы");
  }

  const note =
    input.note === undefined || input.note === null
      ? null
      : input.note.trim() || null;

  await prisma.clientDuplicateReview.upsert({
    where: { fingerprint },
    create: {
      fingerprint,
      status: input.status,
      note,
      reviewedByUserId: input.reviewedByUserId,
    },
    update: {
      status: input.status,
      note,
      reviewedByUserId: input.reviewedByUserId,
    },
  });
}

export async function getActiveDuplicateClientIdSet(): Promise<Set<string>> {
  const clients = await prisma.client.findMany({
    where: { mergedIntoClientId: null },
    select: clientDuplicateSelect,
    orderBy: { updatedAt: "desc" },
  });

  const edges = buildDuplicateEdges(clients);
  const groups = buildGroupsFromEdges(clients, edges);
  if (groups.length === 0) {
    return new Set();
  }

  const reviews = await prisma.clientDuplicateReview.findMany({
    where: {
      fingerprint: { in: groups.map((group) => group.fingerprint) },
    },
  });
  const reviewMap = new Map(reviews.map((review) => [review.fingerprint, review.status]));

  const activeIds = new Set<string>();
  for (const group of groups) {
    const status = reviewMap.get(group.fingerprint) ?? "REVIEW";
    if (status === "NOT_DUPLICATE") {
      continue;
    }
    for (const client of group.clients) {
      activeIds.add(client.id);
    }
  }

  return activeIds;
}
