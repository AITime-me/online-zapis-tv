import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { isAssignableUserRole } from "@/lib/auth/role-catalog";
import type {
  UserAdminCreateInput,
  UserAdminDto,
  UserAdminUpdateInput,
} from "@/types/user-admin";
import type { Prisma, UserRole } from "@prisma/client";

export class UserAdminValidationError extends Error {}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  phone: true,
  positionTitle: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

type UserAdminRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new UserAdminValidationError(`${label} не может быть пустым`);
  }
  return trimmed;
}

function validateEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new UserAdminValidationError("Укажите корректный email");
  }
  return normalized;
}

function validatePassword(password: string): string {
  const trimmed = password.trim();
  const policyError = validatePasswordPolicy(trimmed);
  if (policyError) {
    throw new UserAdminValidationError(policyError);
  }
  return trimmed;
}

function validateRole(role: UserRole): UserRole {
  if (!isAssignableUserRole(role)) {
    throw new UserAdminValidationError("Выбранная роль недоступна для назначения");
  }
  return role;
}

async function countActiveOwners(excludeUserId?: string): Promise<number> {
  return prisma.user.count({
    where: {
      role: "OWNER",
      isActive: true,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  });
}

async function isProtectedOwnerUser(
  user: Pick<UserAdminRow, "id" | "role" | "isActive">,
): Promise<boolean> {
  if (user.role !== "OWNER" || !user.isActive) {
    return false;
  }
  const otherActiveOwners = await countActiveOwners(user.id);
  return otherActiveOwners === 0;
}

async function mapUser(row: UserAdminRow): Promise<UserAdminDto> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    phone: row.phone,
    positionTitle: row.positionTitle,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    isProtectedOwner: await isProtectedOwnerUser(row),
  };
}

async function mapUsers(rows: UserAdminRow[]): Promise<UserAdminDto[]> {
  const activeOwnerIds = rows
    .filter((row) => row.role === "OWNER" && row.isActive)
    .map((row) => row.id);
  const protectedOwnerId =
    activeOwnerIds.length === 1 && (await countActiveOwners(activeOwnerIds[0])) === 0
      ? activeOwnerIds[0]
      : null;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    phone: row.phone,
    positionTitle: row.positionTitle,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    isProtectedOwner: protectedOwnerId === row.id,
  }));
}

async function assertOwnerCanBeModified(
  user: Pick<UserAdminRow, "id" | "role" | "isActive">,
  next: { role?: UserRole; isActive?: boolean },
): Promise<void> {
  const protectedOwner = await isProtectedOwnerUser(user);
  if (!protectedOwner) {
    return;
  }

  if (next.isActive === false) {
    throw new UserAdminValidationError(
      "Нельзя отключить последнего активного владельца системы",
    );
  }

  if (next.role !== undefined && next.role !== "OWNER") {
    throw new UserAdminValidationError(
      "Нельзя сменить роль последнего активного владельца системы",
    );
  }
}

export async function listUsersForAdmin(): Promise<UserAdminDto[]> {
  const rows = await prisma.user.findMany({
    select: userSelect,
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });
  return mapUsers(rows);
}

export async function getUserForAdmin(id: string): Promise<UserAdminDto | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    select: userSelect,
  });
  return row ? mapUser(row) : null;
}

export async function createUserForAdmin(
  input: UserAdminCreateInput,
): Promise<UserAdminDto> {
  const name = requireNonEmpty(input.name, "Имя");
  const email = validateEmail(input.email);
  const role = validateRole(input.role);
  const password = validatePassword(input.temporaryPassword);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new UserAdminValidationError("Пользователь с таким email уже существует");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: {
      name,
      email,
      role,
      passwordHash,
      phone: normalizeOptionalText(input.phone),
      positionTitle: normalizeOptionalText(input.positionTitle),
      notes: normalizeOptionalText(input.notes),
      isActive: true,
    },
    select: userSelect,
  });

  return mapUser(created);
}

export async function updateUserForAdmin(
  id: string,
  input: UserAdminUpdateInput,
): Promise<UserAdminDto> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    throw new UserAdminValidationError("Пользователь не найден");
  }

  await assertOwnerCanBeModified(existing, {
    role: input.role,
    isActive: input.isActive,
  });

  const data: Prisma.UserUpdateInput = {};

  if (input.name !== undefined) {
    data.name = requireNonEmpty(input.name, "Имя");
  }

  if (input.email !== undefined) {
    const email = validateEmail(input.email);
    if (email !== existing.email) {
      const duplicate = await prisma.user.findUnique({ where: { email } });
      if (duplicate && duplicate.id !== id) {
        throw new UserAdminValidationError("Пользователь с таким email уже существует");
      }
    }
    data.email = email;
  }

  if (input.role !== undefined) {
    data.role = validateRole(input.role);
  }

  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  if (input.phone !== undefined) {
    data.phone = normalizeOptionalText(input.phone);
  }

  if (input.positionTitle !== undefined) {
    data.positionTitle = normalizeOptionalText(input.positionTitle);
  }

  if (input.notes !== undefined) {
    data.notes = normalizeOptionalText(input.notes);
  }

  if (input.temporaryPassword !== undefined) {
    const password = validatePassword(input.temporaryPassword);
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: userSelect,
  });

  return mapUser(updated);
}

export async function deactivateUserForAdmin(id: string): Promise<UserAdminDto> {
  return updateUserForAdmin(id, { isActive: false });
}
