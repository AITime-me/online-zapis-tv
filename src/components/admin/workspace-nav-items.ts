import type { AdminSection } from "@/lib/auth/permissions";

export type WorkspaceNavKey =
  | "schedule"
  | "masters"
  | "services"
  | "booking-requests"
  | "clients"
  | "promotions"
  | "game"
  | "users"
  | "settings"
  | "bot"
  | "export";

export type WorkspaceNavItem = {
  key: WorkspaceNavKey;
  section: AdminSection | null;
  href: string;
  label: string;
  adminLabel?: string;
};

export const WORKSPACE_NAV_ITEMS: WorkspaceNavItem[] = [
  {
    key: "schedule",
    section: null,
    href: "/schedule",
    label: "Расписание",
    adminLabel: "К расписанию",
  },
  {
    key: "masters",
    section: "masters",
    href: "/admin/masters",
    label: "Мастера",
  },
  {
    key: "services",
    section: "services",
    href: "/admin/services",
    label: "Услуги",
  },
  {
    key: "booking-requests",
    section: "booking-requests",
    href: "/admin/booking-requests",
    label: "Заявки",
  },
  {
    key: "clients",
    section: "clients",
    href: "/admin/clients",
    label: "Клиенты",
  },
  {
    key: "promotions",
    section: "promotions",
    href: "/admin/promotions",
    label: "Акции",
  },
  {
    key: "game",
    section: "game",
    href: "/admin/game",
    label: "Игра",
  },
  {
    key: "bot",
    section: "bot",
    href: "/admin/bot",
    label: "Бот",
  },
  {
    key: "users",
    section: "users",
    href: "/admin/users",
    label: "Пользователи",
  },
  {
    key: "settings",
    section: "system-settings",
    href: "/admin/settings",
    label: "Настройки",
  },
  {
    key: "export",
    section: "emergency-export",
    href: "/admin/emergency-export",
    label: "Аварийная выгрузка",
  },
];
