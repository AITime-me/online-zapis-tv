import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import {
  INTERNAL_ROLES,
  OPERATIONAL_ADMIN_ROLES,
  OWNER_ROLES,
} from "@/lib/auth/permissions";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import { verifySessionFreshness } from "@/lib/auth/session-freshness";

export type ApiAuthSuccess = {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    role: UserRole;
  };
};

export type ApiAuthResult = ApiAuthSuccess | { response: NextResponse };

export async function requireApiRoles(
  allowedRoles: UserRole[],
): Promise<ApiAuthResult> {
  const session = await auth();
  const user = await verifySessionFreshness(session);

  if (!user) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  if (!allowedRoles.includes(user.role)) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 },
      ),
    };
  }

  return { user };
}

export async function requireProtectedMutatingApi(
  allowedRoles: UserRole[],
  request: Request,
): Promise<ApiAuthResult> {
  const csrfResponse = enforceSameOriginForMutatingRequest(request);
  if (csrfResponse) {
    return { response: csrfResponse };
  }

  return requireApiRoles(allowedRoles);
}

export async function requireProtectedInternalMutatingApi(
  request: Request,
): Promise<ApiAuthResult> {
  return requireProtectedMutatingApi(INTERNAL_ROLES, request);
}

export const WRITE_SCHEDULE_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const MANAGE_MASTERS_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const MANAGE_SERVICES_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const BOOKING_REQUESTS_ADMIN_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const CLIENTS_ADMIN_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const EXPORT_ALLOWED_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const PROMOTIONS_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const GAME_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const USERS_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const SYSTEM_SETTINGS_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const BOT_SETTINGS_VIEW_ROLES: UserRole[] = OWNER_ROLES;

export const BOT_SETTINGS_EDIT_ROLES: UserRole[] = OWNER_ROLES;

export const INTERNAL_API_ROLES: UserRole[] = INTERNAL_ROLES;

export async function requireInternalApiAuth(): Promise<ApiAuthResult> {
  return requireApiRoles(INTERNAL_API_ROLES);
}
