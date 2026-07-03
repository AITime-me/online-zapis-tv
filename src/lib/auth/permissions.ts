import type { UserRole } from "@prisma/client";

export const INTERNAL_ROLES: UserRole[] = ["OWNER", "MANAGER", "MASTER"];

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Владелец",
  MANAGER: "Менеджер",
  MASTER: "Мастер",
};

export function canAccessInternalZone(role: UserRole): boolean {
  return INTERNAL_ROLES.includes(role);
}

export function canManageFullSchedule(role: UserRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}

export function isMasterRole(role: UserRole): boolean {
  return role === "MASTER";
}
