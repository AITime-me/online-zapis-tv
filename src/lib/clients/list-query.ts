import "server-only";

import type { ClientStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clientMatchesTagSearch } from "@/lib/clients/tags";
import {
  CLIENT_LIST_PAGE_SIZES,
  DEFAULT_CLIENT_LIST_PAGE_SIZE,
} from "@/lib/clients/list-contract";

export type ClientArchiveFilter = "all" | "active" | "archived";
export type ClientStatusFilter = "all" | ClientStatus;

export type ClientListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ClientStatusFilter;
  archive?: ClientArchiveFilter;
};

export {
  CLIENT_LIST_PAGE_SIZES,
  DEFAULT_CLIENT_LIST_PAGE_SIZE,
} from "@/lib/clients/list-contract";

export function parseClientListQuery(
  searchParams: URLSearchParams,
): ClientListQuery {
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(
    searchParams.get("pageSize") ?? String(DEFAULT_CLIENT_LIST_PAGE_SIZE),
    10,
  );
  const status = searchParams.get("status");
  const archive = searchParams.get("archive");

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: CLIENT_LIST_PAGE_SIZES.includes(
      pageSize as (typeof CLIENT_LIST_PAGE_SIZES)[number],
    )
      ? pageSize
      : DEFAULT_CLIENT_LIST_PAGE_SIZE,
    search: searchParams.get("q")?.trim() || undefined,
    status:
      status && status !== "all"
        ? (status as ClientStatus)
        : "all",
    archive:
      archive === "archived" || archive === "all" || archive === "active"
        ? archive
        : "active",
  };
}

function buildArchiveWhere(
  archive: ClientArchiveFilter = "active",
): Prisma.ClientWhereInput {
  if (archive === "active") {
    return { isArchived: false };
  }
  if (archive === "archived") {
    return { isArchived: true };
  }
  return {};
}

function buildStatusWhere(
  status: ClientStatusFilter = "all",
): Prisma.ClientWhereInput {
  if (status === "all") {
    return {};
  }
  return { status };
}

export async function findClientIdsMatchingSearch(
  search: string,
): Promise<string[]> {
  const query = search.trim();
  if (!query) {
    return [];
  }

  const pattern = `%${query}%`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM clients
    WHERE
      full_name ILIKE ${pattern}
      OR COALESCE(phone, '') ILIKE ${pattern}
      OR COALESCE(email, '') ILIKE ${pattern}
      OR COALESCE(normalized_phone, '') ILIKE ${pattern}
      OR EXISTS (
        SELECT 1
        FROM unnest(tags) AS t(tag)
        WHERE t.tag ILIKE ${pattern}
      )
  `;

  return rows.map((row) => row.id);
}

export async function buildClientListWhere(
  query: ClientListQuery,
): Promise<Prisma.ClientWhereInput> {
  const where: Prisma.ClientWhereInput = {
    ...buildArchiveWhere(query.archive ?? "active"),
    ...buildStatusWhere(query.status ?? "all"),
  };

  const search = query.search?.trim();
  if (!search) {
    return where;
  }

  const matchingIds = await findClientIdsMatchingSearch(search);
  return {
    AND: [
      where,
      matchingIds.length > 0 ? { id: { in: matchingIds } } : { id: { in: [] } },
    ],
  };
}

export function matchesClientSearch(
  client: {
    fullName: string;
    phone: string | null;
    email: string | null;
    tags: string[];
  },
  search: string,
): boolean {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }

  const haystack = [client.fullName, client.phone ?? "", client.email ?? ""]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query) || clientMatchesTagSearch(client.tags, query);
}
