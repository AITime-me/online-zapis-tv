import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { auth } from "@/auth";

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

export const EXPORT_ALLOWED_ROLES: UserRole[] = ["OWNER", "MANAGER"];

export const INTERNAL_API_ROLES: UserRole[] = ["OWNER", "MANAGER", "MASTER"];

export async function requireInternalApiAuth(): Promise<ApiAuthResult> {
  return requireApiRoles(INTERNAL_API_ROLES);
}
