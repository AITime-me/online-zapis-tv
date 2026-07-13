/**
 * Бизнес-логика аварийного сброса пароля OWNER (используется CLI и тестами).
 *
 * Модуль без side effects при импорте: Prisma внедряется извне, поэтому логику
 * можно проверять с мок-клиентом без подключения к реальной БД.
 *
 * Хеширование не выполняется здесь — функция хеша внедряется, чтобы CLI
 * использовал тот же bcrypt-параметр, что вход и создание OWNER.
 */

import type { UserRole } from "@prisma/client";
import { validatePasswordPolicy } from "./password-policy";

export class OwnerPasswordResetError extends Error {}

const OWNER_ROLE: UserRole = "OWNER";

type OwnerRow = {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
};

const OWNER_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
} as const;

type ResetTxClient = {
  user: {
    findUnique(args: {
      where: { email: string };
      select: typeof OWNER_SELECT;
    }): Promise<OwnerRow | null>;
    update(args: {
      where: { id: string };
      data: { passwordHash: string; passwordChangedAt: Date };
    }): Promise<unknown>;
  };
  passwordResetToken: {
    deleteMany(args: {
      where: { userId: string; usedAt: null };
    }): Promise<{ count: number }>;
  };
};

export type OwnerResetPrisma = {
  user: {
    findUnique(args: {
      where: { email: string };
      select: typeof OWNER_SELECT;
    }): Promise<OwnerRow | null>;
  };
  $transaction<T>(fn: (tx: ResetTxClient) => Promise<T>): Promise<T>;
};

export type OwnerResetHashFn = (plainPassword: string) => Promise<string>;

export type OwnerResetResult = {
  email: string;
  /** Кол-во удалённых неиспользованных reset-токенов (не секрет). */
  invalidatedTokens: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Предпроверка (также используется для --dry-run): пользователь существует и
 * имеет строго роль OWNER. Только чтение, БД не изменяется.
 */
export async function assertOwnerResettable(
  db: OwnerResetPrisma,
  email: string,
): Promise<{ id: string; email: string }> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new OwnerPasswordResetError("Email обязателен.");
  }

  const user = await db.user.findUnique({
    where: { email: normalized },
    select: OWNER_SELECT,
  });

  if (!user) {
    throw new OwnerPasswordResetError(`Пользователь с email ${normalized} не найден.`);
  }

  if (user.role !== OWNER_ROLE) {
    throw new OwnerPasswordResetError(
      "Сброс через этот скрипт доступен только для пользователя с ролью OWNER.",
    );
  }

  return { id: user.id, email: user.email };
}

/**
 * Проверка нового пароля до записи: непустой, соответствует политике,
 * подтверждение совпадает. Бросает OwnerPasswordResetError (без секретов).
 */
export function validateNewOwnerPassword(password: string, confirmation: string): void {
  if (!password) {
    throw new OwnerPasswordResetError("Пароль не может быть пустым.");
  }

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    throw new OwnerPasswordResetError(policyError);
  }

  if (password !== confirmation) {
    throw new OwnerPasswordResetError("Пароли не совпадают.");
  }
}

/**
 * Атомарный сброс пароля OWNER одной транзакцией:
 *   1. заново находим пользователя и проверяем роль OWNER;
 *   2. заменяем passwordHash;
 *   3. ставим passwordChangedAt = now (инвалидирует старые JWT);
 *   4. удаляем неиспользованные PasswordResetToken пользователя.
 *
 * Токены удаляются (а не помечаются использованными): reset-flow ещё нет,
 * ephemeral-токены не несут аудит-ценности, а удаление гарантированно
 * исключает их дальнейшее использование. При любой ошибке транзакция
 * откатывается — частично изменённого состояния не остаётся.
 */
export async function applyOwnerPasswordReset(
  db: OwnerResetPrisma,
  params: { email: string; newPassword: string },
  hashPassword: OwnerResetHashFn,
  now: Date = new Date(),
): Promise<OwnerResetResult> {
  const normalized = normalizeEmail(params.email);

  const policyError = validatePasswordPolicy(params.newPassword);
  if (policyError) {
    throw new OwnerPasswordResetError(policyError);
  }

  const passwordHash = await hashPassword(params.newPassword);

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: normalized },
      select: OWNER_SELECT,
    });

    if (!user) {
      throw new OwnerPasswordResetError(`Пользователь с email ${normalized} не найден.`);
    }

    if (user.role !== OWNER_ROLE) {
      throw new OwnerPasswordResetError(
        "Сброс через этот скрипт доступен только для пользователя с ролью OWNER.",
      );
    }

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: now },
    });

    const invalidated = await tx.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    return { email: user.email, invalidatedTokens: invalidated.count };
  });
}
