/**
 * Аварийный сброс пароля OWNER (только через SSH на сервере).
 *
 * Usage:
 *   npm run owner:reset-password -- --email owner@studio.ru
 *   npm run owner:reset-password -- --email owner@studio.ru --dry-run
 *
 * Пароль вводится ТОЛЬКО интерактивно скрытым prompt (без echo). Передавать
 * пароль через argv / переменную окружения / файл / stdin pipe запрещено:
 * promptHidden требует TTY, а флаг --password отклоняется явно.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  applyOwnerPasswordReset,
  assertOwnerResettable,
  normalizeEmail,
  OwnerPasswordResetError,
  validateNewOwnerPassword,
} from "../src/lib/auth/owner-password-reset";
import { promptHidden, promptLine } from "./lib/prompt";

const BCRYPT_COST = 10;

type ParsedArgs = {
  dryRun: boolean;
  email?: string;
};

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);

  // Пароль нельзя передавать аргументом — отказываемся явно, чтобы он не попал
  // в process list / shell history.
  if (argv.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
    throw new OwnerPasswordResetError(
      "Пароль нельзя передавать аргументом. Он запрашивается интерактивно скрытым вводом.",
    );
  }

  const dryRun = argv.includes("--dry-run");

  const readFlagValue = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) {
      return undefined;
    }
    return argv[index + 1]?.trim() || undefined;
  };

  return {
    dryRun,
    email: readFlagValue("--email"),
  };
}

function validateEmailFormat(email: string): void {
  if (!email) {
    throw new OwnerPasswordResetError("Email обязателен.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OwnerPasswordResetError("Некорректный формат email.");
  }
}

async function resolveEmail(initial?: string): Promise<string> {
  const raw = initial ?? (await promptLine("Email OWNER: "));
  return normalizeEmail(raw);
}

async function main(): Promise<void> {
  const args = parseArgs();

  const email = await resolveEmail(args.email);
  validateEmailFormat(email);

  const prisma = new PrismaClient();

  try {
    // Предпроверка: пользователь существует и его роль строго OWNER.
    const target = await assertOwnerResettable(prisma, email);

    if (args.dryRun) {
      console.log("\nСброс пароля OWNER — dry-run (БД не изменяется, пароль не запрашивается)\n");
      console.log(`  Email: ${target.email}`);
      console.log("  Роль:  OWNER");
      console.log("  Операция доступна: да");
      console.log("\nПри реальном запуске:");
      console.log("  1. Запросит новый пароль интерактивно (дважды, скрыто)");
      console.log("  2. Проверит политику пароля и совпадение");
      console.log("  3. Атомарно обновит passwordHash + passwordChangedAt");
      console.log("  4. Удалит неиспользованные reset-токены пользователя");
      return;
    }

    const password = await promptHidden("Новый пароль (не отображается): ");
    const confirmation = await promptHidden("Повторите новый пароль: ");
    validateNewOwnerPassword(password, confirmation);

    const result = await applyOwnerPasswordReset(
      prisma,
      { email, newPassword: password },
      (plain) => bcrypt.hash(plain, BCRYPT_COST),
    );

    console.log(`\nПароль OWNER (${result.email}) успешно изменён.`);
    console.log(`Инвалидировано неиспользованных reset-токенов: ${result.invalidatedTokens}.`);
    console.log("Все прежние сессии отозваны (passwordChangedAt обновлён).");
    console.log("Войдите новым паролем.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // OwnerPasswordResetError несёт безопасное сообщение оператору.
  // Прочие ошибки (например, БД) не выводим детально, чтобы не раскрывать секреты.
  if (error instanceof OwnerPasswordResetError) {
    console.error(`Ошибка: ${error.message}`);
  } else {
    console.error(
      "Не удалось сбросить пароль OWNER. Проверьте подключение к БД и параметры запуска.",
    );
  }
  process.exit(1);
});
