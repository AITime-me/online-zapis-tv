/**
 * Проверка свежести сессии (Node.js server-side guard).
 *
 * Сессия Auth.js — stateless JWT. Чтобы смена пароля инвалидировала старые
 * токены, при защищённом доступе сверяем момент выдачи сессии (authTime)
 * с актуальным User.passwordChangedAt из БД.
 *
 * Сессия недействительна, если:
 *   - пользователя нет в БД;
 *   - пользователь неактивен;
 *   - JWT выдан раньше passwordChangedAt.
 *
 * Актуальная роль всегда берётся из БД (не из JWT): смена роли применяется
 * немедленно к старой сессии на уровне Node-guard (страницы и API).
 *
 * Отказоустойчивость: любая ошибка (в т.ч. БД) → безопасный отказ (null),
 * а не разрешение доступа. В лог попадает только обобщённое сообщение —
 * без userId, email, JWT, cookie и секретов.
 *
 * Модуль без side effects при импорте (ленивый импорт Prisma) — тестируется
 * с внедрённым клиентом БД, публичные пути к БД не обращаются.
 */

import type { UserRole } from "@prisma/client";

export type FreshSessionUser = {
  id: string;
  role: UserRole;
  email?: string | null;
  name?: string | null;
};

type SessionInput =
  | {
      user?: {
        id?: string | null;
        role?: UserRole;
        email?: string | null;
        name?: string | null;
      } | null;
      authTime?: number | null;
    }
  | null
  | undefined;

type FreshnessUserState = {
  isActive: boolean;
  role: UserRole;
  passwordChangedAt: Date | null;
};

export type FreshnessPrisma = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { isActive: true; role: true; passwordChangedAt: true };
    }): Promise<FreshnessUserState | null>;
  };
};

/**
 * Чистая проверка: сессия свежая, если пароль не менялся, либо JWT выдан
 * не раньше момента смены пароля. Если пароль менялся, но authTime отсутствует
 * или некорректен — безопасный отказ.
 *
 * Сравнение ведётся в миллисекундах: authTime (Unix seconds) переводится в мс,
 * passwordChangedAt НЕ округляется вниз до секунды. Иначе вход в 10:00:00.100 и
 * смена пароля в 10:00:00.900 (одна секунда) ошибочно считались бы совместимыми.
 * Эквивалентно правилу: authTime * 1000 < passwordChangedAt.getTime() → устарела.
 */
export function isSessionFresh(
  authTimeSeconds: number | null | undefined,
  passwordChangedAt: Date | null,
): boolean {
  if (!passwordChangedAt) {
    return true;
  }

  if (typeof authTimeSeconds !== "number" || !Number.isFinite(authTimeSeconds)) {
    return false;
  }

  const changedAtMs = passwordChangedAt.getTime();
  if (!Number.isFinite(changedAtMs)) {
    return false;
  }

  return authTimeSeconds * 1000 >= changedAtMs;
}

export async function verifySessionFreshness(
  session: SessionInput,
  db?: FreshnessPrisma,
): Promise<FreshSessionUser | null> {
  const user = session?.user;
  // role в JWT используется только как маркер «сессия выглядит внутренней»;
  // фактические полномочия определяются ролью из БД ниже.
  if (!user?.id || !user.role) {
    return null;
  }

  try {
    const client =
      db ?? ((await import("@/lib/db")).prisma as unknown as FreshnessPrisma);

    const state = await client.user.findUnique({
      where: { id: user.id },
      select: { isActive: true, role: true, passwordChangedAt: true },
    });

    if (!state || !state.isActive) {
      return null;
    }

    if (!isSessionFresh(session?.authTime ?? null, state.passwordChangedAt)) {
      return null;
    }

    return {
      id: user.id,
      role: state.role,
      email: user.email ?? null,
      name: user.name ?? null,
    };
  } catch {
    console.error("[auth] session freshness check failed");
    return null;
  }
}
