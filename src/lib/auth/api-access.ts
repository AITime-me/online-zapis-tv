import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import {
  INTERNAL_ROLES,
  OPERATIONAL_ADMIN_ROLES,
  OWNER_ROLES,
} from "@/lib/auth/permissions";

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

  if (!session?.user) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  if (!allowedRoles.includes(session.user.role)) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 },
      ),
    };
  }

  return { user: session.user };
}

export const WRITE_SCHEDULE_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const MANAGE_MASTERS_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const MANAGE_SERVICES_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const BOOKING_REQUESTS_ADMIN_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const EXPORT_ALLOWED_ROLES: UserRole[] = OPERATIONAL_ADMIN_ROLES;

export const PROMOTIONS_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const GAME_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const USERS_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const SYSTEM_SETTINGS_ADMIN_ROLES: UserRole[] = OWNER_ROLES;

export const INTERNAL_API_ROLES: UserRole[] = INTERNAL_ROLES;

export async function requireInternalApiAuth(): Promise<ApiAuthResult> {
  return requireApiRoles(INTERNAL_API_ROLES);
}
