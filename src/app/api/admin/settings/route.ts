import { NextResponse } from "next/server";
import { SYSTEM_SETTINGS_ADMIN_ROLES } from "@/lib/auth/api-access";
import { requireApiRoles } from "@/lib/auth/api-access";
import {
  StudioSettingsValidationError,
  getStudioSettings,
  updateStudioSettings,
} from "@/services/StudioSettingsService";
import type { StudioSettingsWriteInput } from "@/types/studio-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(SYSTEM_SETTINGS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const settings = await getStudioSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function PATCH(request: Request) {
  const authResult = await requireApiRoles(SYSTEM_SETTINGS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as StudioSettingsWriteInput;
    const settings = await updateStudioSettings(body);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    if (error instanceof StudioSettingsValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
