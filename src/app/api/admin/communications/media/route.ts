import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import {
  CommMediaValidationError,
  uploadCampaignImage,
} from "@/services/CommunicationsMediaService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Не передан файл изображения" },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await uploadCampaignImage({
      buffer,
      declaredMime: file.type,
      fileName: file.name,
      userId: authResult.user.id,
    });
    return NextResponse.json({
      ok: true,
      asset,
      previewUrl: `/api/admin/communications/media/${asset.id}`,
    });
  } catch (error) {
    if (error instanceof CommMediaValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return communicationsAdminErrorResponse(error);
  }
}
