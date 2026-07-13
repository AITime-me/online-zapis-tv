/**
 * Обновление User.lastLoginAt после успешного входа.
 *
 * Вызывается только из обработчика успешного входа Auth.js (events.signIn),
 * то есть после подтверждённой проверки email, активности и пароля.
 * Не вызывается при неудачном входе, обновлении JWT или чтении сессии.
 *
 * Ошибка обновления проглатывается: вход не должен падать из-за телеметрии,
 * и в лог не попадают идентификаторы, email, пароли или токены.
 */

type LastLoginPrisma = {
  user: {
    update(args: {
      where: { id: string };
      data: { lastLoginAt: Date };
      select: { id: true };
    }): Promise<unknown>;
  };
};

export async function markLastLogin(
  userId: string,
  now: Date = new Date(),
  db?: LastLoginPrisma,
): Promise<void> {
  if (!userId) {
    return;
  }

  try {
    const client =
      db ?? ((await import("@/lib/db")).prisma as unknown as LastLoginPrisma);

    await client.user.update({
      where: { id: userId },
      data: { lastLoginAt: now },
      select: { id: true },
    });
  } catch {
    console.error("[auth] failed to update lastLoginAt");
  }
}
