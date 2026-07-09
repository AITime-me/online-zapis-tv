import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  ClientDuplicateValidationError,
  listClientDuplicateGroups,
} from "@/services/ClientDuplicateService";
import type {
  ClientDuplicateFilters,
  DuplicateConfidence,
} from "@/types/client-duplicates";
import type { ClientDuplicateReviewStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseConfidenceFilter(
  value: string | null,
): DuplicateConfidence | "all" {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value;
  }
  return "all";
}

function parseReviewStatusFilter(
  value: string | null,
): ClientDuplicateReviewStatus | "all" {
  if (
    value === "REVIEW" ||
    value === "NOT_DUPLICATE" ||
    value === "POSTPONED"
  ) {
    return value;
  }
  return "all";
}

function duplicateErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientDuplicateValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось загрузить возможные дубли" },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const filters: ClientDuplicateFilters = {
      confidence: parseConfidenceFilter(searchParams.get("confidence")),
      reviewStatus: parseReviewStatusFilter(searchParams.get("reviewStatus")),
      q: searchParams.get("q")?.trim() || undefined,
    };

    const { summary, groups } = await listClientDuplicateGroups(filters);
    return NextResponse.json({ ok: true, summary, groups });
  } catch (error) {
    return duplicateErrorResponse(error);
  }
}
