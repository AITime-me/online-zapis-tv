import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import {
  canAccessAdminSection,
  canAccessInternalZone,
  OWNER_ROLES,
  type AdminSection,
} from "@/lib/auth/permissions";

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireAuth() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (!canAccessInternalZone(user.role)) {
    redirect("/login");
  }

  return user;
}

export async function requireRole(allowedRoles: UserRole[]) {
  const user = await requireAuth();

  if (!allowedRoles.includes(user.role)) {
    redirect("/schedule");
  }

  return user;
}

export async function requireOwner() {
  return requireRole(OWNER_ROLES);
}

export async function requireAdminSection(section: AdminSection) {
  const user = await requireAuth();

  if (!canAccessAdminSection(user.role, section)) {
    redirect("/schedule");
  }

  return user;
}
