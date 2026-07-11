/**
 * Безопасное создание первого (или дополнительного) OWNER.
 *
 * Usage:
 *   npm run owner:create
 *   npm run owner:create -- --dry-run
 *   npm run owner:create -- --dry-run --email owner@studio.ru --name "Имя владельца"
 */

import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { promptHidden, promptLine, promptYesNo } from "./lib/prompt";

const FORBIDDEN_EMAIL_SUFFIX = "@example.local";
const MIN_PASSWORD_LENGTH = 12;

type ParsedArgs = {
  dryRun: boolean;
  email?: string;
  name?: string;
};

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
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
    name: readFlagValue("--name"),
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateEmail(email: string): string | null {
  if (!email) {
    return "Email обязателен.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Некорректный формат email.";
  }

  if (email.endsWith(FORBIDDEN_EMAIL_SUFFIX)) {
    return `Email с доменом ${FORBIDDEN_EMAIL_SUFFIX} запрещён.`;
  }

  return null;
}

function validateName(name: string): string | null {
  if (!name.trim()) {
    return "Имя владельца обязательно.";
  }

  if (name.trim().length < 2) {
    return "Имя должно содержать не менее 2 символов.";
  }

  return null;
}

function validatePasswordPolicy(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов.`;
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return "Пароль должен содержать буквы верхнего и нижнего регистра.";
  }

  if (!/\d/.test(password)) {
    return "Пароль должен содержать хотя бы одну цифру.";
  }

  if (password === "password123") {
    return "Тестовый пароль password123 запрещён.";
  }

  return null;
}

async function resolveEmail(initial?: string): Promise<string> {
  if (initial) {
    return normalizeEmail(initial);
  }

  return normalizeEmail(await promptLine("Email владельца (OWNER): "));
}

async function resolveName(initial?: string): Promise<string> {
  if (initial) {
    return initial.trim();
  }

  return (await promptLine("Имя владельца: ")).trim();
}

async function resolvePassword(dryRun: boolean, hasPresetIdentity: boolean): Promise<string | null> {
  if (dryRun && hasPresetIdentity) {
    return null;
  }

  const password = await promptHidden("Пароль (не отображается): ");
  const passwordError = validatePasswordPolicy(password);

  if (passwordError) {
    throw new Error(passwordError);
  }

  const confirmation = await promptHidden("Повторите пароль: ");

  if (password !== confirmation) {
    throw new Error("Пароли не совпадают.");
  }

  return password;
}

async function main(): Promise<void> {
  const args = parseArgs();

  const email = await resolveEmail(args.email);
  const emailError = validateEmail(email);
  if (emailError) {
    throw new Error(emailError);
  }

  const name = await resolveName(args.name);
  const nameError = validateName(name);
  if (nameError) {
    throw new Error(nameError);
  }

  const hasPresetIdentity = Boolean(args.email && args.name);
  const password = await resolvePassword(args.dryRun, hasPresetIdentity);

  if (args.dryRun) {
    console.log("\nCreate OWNER — dry-run (запись в БД не выполняется)\n");
    console.log(`  Email: ${email}`);
    console.log(`  Имя:   ${name}`);
    console.log(`  Роль:  OWNER (active)`);
    console.log(
      password
        ? "  Пароль: [установлен, не выводится]"
        : "  Пароль: [будет запрошен интерактивно при реальном запуске]",
    );
    console.log("\nДействия при реальном запуске:");
    console.log("  1. Проверить, существует ли пользователь с таким email");
    console.log("  2. Предупредить, если активный OWNER уже есть");
    console.log("  3. Запросить подтверждение");
    console.log("  4. Создать пользователя с ролью OWNER");
    return;
  }

  const prisma = new PrismaClient();

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new Error(
        `Пользователь с email ${email} уже существует (роль: ${existingUser.role}). ` +
          "Скрипт не меняет пароль или роль существующих пользователей.",
      );
    }

    const activeOwners = await prisma.user.count({
      where: { role: UserRole.OWNER, isActive: true },
    });

    if (activeOwners > 0) {
      console.warn(
        `\nВнимание: в системе уже ${activeOwners} активных OWNER. Создание ещё одного — исключительная ситуация.`,
      );
      const confirmedExtra = await promptYesNo("Продолжить создание дополнительного OWNER?", false);
      if (!confirmedExtra) {
        console.log("Отменено.");
        return;
      }
    }

    console.log("\nПодтвердите создание OWNER:");
    console.log(`  Email: ${email}`);
    console.log(`  Имя:   ${name}`);

    const confirmed = await promptYesNo("\nСоздать пользователя?", false);
    if (!confirmed) {
      console.log("Отменено.");
      return;
    }

    if (!password) {
      throw new Error("Пароль не получен.");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const owner = await prisma.user.create({
      data: {
        email,
        name,
        role: UserRole.OWNER,
        isActive: true,
        passwordHash,
        positionTitle: "Владелец студии",
      },
    });

    console.log(`\nOWNER создан: ${owner.email} (id=${owner.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
