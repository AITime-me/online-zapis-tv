import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import {
  CommMediaValidationError,
  deleteMediaAsset,
  getMediaAssetBytes,
} from "@/services/CommunicationsMediaService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(COMMUNICATIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  try {
    const asset = await getMediaAssetBytes(id);
    if (!asset) {
      return NextResponse.json({ ok: false, error: "Не найдено" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(asset.data), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  try {
    await deleteMediaAsset(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CommMediaValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return communicationsAdminErrorResponse(error);
  }
}
