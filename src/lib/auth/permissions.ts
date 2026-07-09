import type { UserRole } from "@prisma/client";

export const INTERNAL_ROLES: UserRole[] = ["OWNER", "MANAGER", "MASTER"];

export const OWNER_ROLES: UserRole[] = ["OWNER"];

/** Владелец и менеджер студии — операционное администрирование. */
export const OPERATIONAL_ADMIN_ROLES: UserRole[] = ["OWNER", "MANAGER"];

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Владелец",
  MANAGER: "Менеджер",
  MASTER: "Мастер",
};

export type AdminSection =
  | "masters"
  | "services"
  | "booking-requests"
  | "schedule"
  | "promotions"
  | "game"
  | "users"
  | "system-settings"
  | "emergency-export";

/** Разделы /admin/*, доступные менеджеру (операционная админка). */
export const MANAGER_ADMIN_PATH_PREFIXES = [
  "/admin/masters",
  "/admin/services",
  "/admin/booking-requests",
  "/admin/emergency-export",
] as const;

/** Разделы /admin/*, доступные только владельцу. */
export const OWNER_ONLY_ADMIN_PATH_PREFIXES = [
  "/admin/promotions",
  "/admin/game",
  "/admin/users",
  "/admin/settings",
] as const;

export function canAccessInternalZone(role: UserRole): boolean {
  return INTERNAL_ROLES.includes(role);
}

export function isOwner(role: UserRole): boolean {
  return role === "OWNER";
}

export function canManageOperationalEntities(role: UserRole): boolean {
  return OPERATIONAL_ADMIN_ROLES.includes(role);
}

export function canManageFullSchedule(role: UserRole): boolean {
  return canManageOperationalEntities(role);
}

export function canManageMasters(role: UserRole): boolean {
  return canManageOperationalEntities(role);
}

export function canManageServices(role: UserRole): boolean {
  return canManageOperationalEntities(role);
}

export function canManageBookingRequests(role: UserRole): boolean {
  return canManageOperationalEntities(role);
}

/** Заявки в колонке менеджера — только OWNER и MANAGER. */
export function canViewManagerBookingRequests(role: UserRole): boolean {
  return canManageOperationalEntities(role);
}

/** Акции и маркетинговые правила — только владелец. */
export function canManagePromotionsAdmin(role: UserRole): boolean {
  return isOwner(role);
}

/** @deprecated Используйте canManagePromotionsAdmin */
export function canAccessPromotionsAdmin(role: UserRole): boolean {
  return canManagePromotionsAdmin(role);
}

/**
 * Игра «Поймай своё время»: настройки, подарки, вероятности, тексты и изображения.
 * Подготовлено для будущей админки — сейчас только владелец.
 */
export function canManageGameAdmin(role: UserRole): boolean {
  return isOwner(role);
}

/** Создание пользователей, назначение ролей, права доступа — только владелец. */
export function canManageUsersAdmin(role: UserRole): boolean {
  return isOwner(role);
}

/**
 * Фундамент CRM: пользователь User — сотрудник студии (владелец, менеджер, мастер).
 * В будущем те же учётные записи смогут быть ответственными за клиентов, заявки,
 * задачи, переписки (VK / MAX / Telegram / виджет), аналитику и лояльность.
 */
/** Глобальные настройки системы — только владелец. */
export function canManageSystemSettings(role: UserRole): boolean {
  return isOwner(role);
}

export function canAccessEmergencyExport(role: UserRole): boolean {
  return canManageOperationalEntities(role);
}

export function isOwnerOnlyAdminPath(pathname: string): boolean {
  return OWNER_ONLY_ADMIN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isManagerAdminPath(pathname: string): boolean {
  return MANAGER_ADMIN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function canAccessAdminSection(
  role: UserRole,
  section: AdminSection,
): boolean {
  switch (section) {
    case "masters":
      return canManageMasters(role);
    case "services":
      return canManageServices(role);
    case "booking-requests":
      return canManageBookingRequests(role);
    case "schedule":
      return canManageFullSchedule(role);
    case "promotions":
      return canManagePromotionsAdmin(role);
    case "game":
      return canManageGameAdmin(role);
    case "users":
      return canManageUsersAdmin(role);
    case "system-settings":
      return canManageSystemSettings(role);
    case "emergency-export":
      return canAccessEmergencyExport(role);
    default:
      return false;
  }
}

export function canAccessAdminPath(role: UserRole, pathname: string): boolean {
  if (!canManageOperationalEntities(role)) {
    return false;
  }

  if (isOwner(role)) {
    return true;
  }

  if (isOwnerOnlyAdminPath(pathname)) {
    return false;
  }

  return isManagerAdminPath(pathname);
}

export function isMasterRole(role: UserRole): boolean {
  return role === "MASTER";
}
