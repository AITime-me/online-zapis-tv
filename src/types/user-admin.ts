import type { UserRole } from "@prisma/client";

export type UserAdminDto = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  phone: string | null;
  positionTitle: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  /** Последний активный владелец — нельзя отключить или понизить роль. */
  isProtectedOwner: boolean;
};

export type UserAdminCreateInput = {
  name: string;
  email: string;
  role: UserRole;
  phone?: string | null;
  positionTitle?: string | null;
  notes?: string | null;
  temporaryPassword: string;
};

export type UserAdminUpdateInput = {
  name?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
  phone?: string | null;
  positionTitle?: string | null;
  notes?: string | null;
  temporaryPassword?: string;
};
