import type { UserRole } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/auth/permissions";

/** Роли, которые можно назначить через админку сейчас. */
export const ASSIGNABLE_USER_ROLES: UserRole[] = ["OWNER", "MANAGER", "MASTER"];

/**
 * Будущие роли CRM «Твоё время».
 * Пока не добавлены в Prisma enum — подключать поэтапно при появлении разделов:
 * клиенты, задачи, переписки, мессенджеры, аналитика, лояльность.
 */
export const FUTURE_CRM_ROLE_LABELS = {
  ADMIN: "Администратор",
  OPERATOR: "Оператор",
} as const;

export type FutureCrmRole = keyof typeof FUTURE_CRM_ROLE_LABELS;

export function getUserRoleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

export function isAssignableUserRole(role: string): role is UserRole {
  return ASSIGNABLE_USER_ROLES.includes(role as UserRole);
}
