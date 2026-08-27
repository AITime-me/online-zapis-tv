import { NextResponse } from "next/server";
import {
  ACQUISITION_LINK_ADMIN_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { AcquisitionAttributionValidationError } from "@/lib/attribution/trusted-acquisition";
import { mintAcquisitionLink } from "@/services/AcquisitionAttributionService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateAcquisitionLinkBody = {
  sourceKey?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  utmTerm?: unknown;
};

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    ACQUISITION_LINK_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: CreateAcquisitionLinkBody;
  try {
    const parsed = (await request.json()) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("INVALID_BODY");
    }
    const record = parsed as Record<string, unknown>;
    const allowedKeys = new Set([
      "sourceKey",
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmContent",
      "utmTerm",
    ]);
    for (const key of Object.keys(record)) {
      if (!allowedKeys.has(key)) {
        return NextResponse.json(
          { ok: false, error: "Недопустимое поле в теле запроса" },
          { status: 400 },
        );
      }
    }
    body = record as CreateAcquisitionLinkBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Некорректное тело запроса" },
      { status: 400 },
    );
  }

  try {
    const link = await mintAcquisitionLink({
      sourceKey: body.sourceKey,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
      utmContent: body.utmContent,
      utmTerm: body.utmTerm,
    });
    return NextResponse.json({
      ok: true,
      link: {
        publicPath: link.publicPath,
        sourceKey: link.sourceKey,
        utm: link.utm,
        expiresAt: link.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AcquisitionAttributionValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Не удалось создать acquisition-ссылку" },
      { status: 500 },
    );
  }
}
