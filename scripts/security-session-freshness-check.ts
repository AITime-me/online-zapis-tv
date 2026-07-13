import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { UserRole } from "@prisma/client";
import {
  isSessionFresh,
  verifySessionFreshness,
} from "../src/lib/auth/session-freshness";

type UserState = { isActive: boolean; passwordChangedAt: Date | null };

function createMockDb(state: UserState | null, behavior: "ok" | "throw" = "ok") {
  const calls: unknown[] = [];
  return {
    calls,
    db: {
      user: {
        async findUnique(args: unknown) {
          calls.push(args);
          if (behavior === "throw") {
            throw new Error("db down");
          }
          return state;
        },
      },
    },
  };
}

const OWNER: UserRole = "OWNER";

function session(authTime: number | null, overrides?: Record<string, unknown>) {
  return {
    user: { id: "user-xyz", role: OWNER, email: "secret@example.com", name: "N" },
    authTime,
    ...overrides,
  };
}

// --- Pure isSessionFresh ---
function testPure(): void {
  const changed = new Date("2026-07-13T00:00:00.000Z");
  const changedSec = Math.floor(changed.getTime() / 1000);

  assert.equal(isSessionFresh(123, null), true, "null passwordChangedAt → всегда свежая");
  assert.equal(isSessionFresh(changedSec + 10, changed), true, "выдан после смены → свежая");
  assert.equal(isSessionFresh(changedSec, changed), true, "равен моменту смены → свежая");
  assert.equal(isSessionFresh(changedSec - 10, changed), false, "выдан до смены → устаревшая");
  assert.equal(isSessionFresh(undefined, changed), false, "нет authTime при смене → отказ");
  assert.equal(isSessionFresh(Number.NaN, changed), false, "некорректный authTime → отказ");
}

// --- Граница одной секунды: сравнение в миллисекундах ---
function testSubSecondBoundary(): void {
  // Базовая секунда 10:00:00; authTime хранится в Unix seconds.
  const base = new Date("2026-07-13T10:00:00.000Z");
  const authTimeAt0000 = Math.floor(base.getTime() / 1000); // вход 10:00:00.000
  const authTimeAt0100 = authTimeAt0000 + 1; // вход 10:00:01.000

  const changedAt0900 = new Date(base.getTime() + 900); // смена 10:00:00.900

  // 1. authTime 10:00:00.000, passwordChangedAt 10:00:00.900 → отклонить
  assert.equal(
    isSessionFresh(authTimeAt0000, changedAt0900),
    false,
    "вход 10:00:00.000 раньше смены 10:00:00.900 в той же секунде → устаревшая",
  );

  // 2. authTime 10:00:01.000, passwordChangedAt 10:00:00.900 → разрешить
  assert.equal(
    isSessionFresh(authTimeAt0100, changedAt0900),
    true,
    "вход 10:00:01.000 позже смены 10:00:00.900 → свежая",
  );

  // 3. точное равенство миллисекунд → разрешить
  const changedExact = new Date(authTimeAt0000 * 1000);
  assert.equal(
    isSessionFresh(authTimeAt0000, changedExact),
    true,
    "authTime*1000 == passwordChangedAt.getTime() → свежая",
  );

  // 4. нечисловой / отсутствующий authTime при заданном passwordChangedAt → отказ
  assert.equal(isSessionFresh(undefined, changedAt0900), false, "отсутствует authTime → отказ");
  assert.equal(
    isSessionFresh("nope" as unknown as number, changedAt0900),
    false,
    "нечисловой authTime → отказ",
  );
  assert.equal(isSessionFresh(Number.NaN, changedAt0900), false, "NaN authTime → отказ");

  // 5. некорректная дата passwordChangedAt → безопасный отказ
  assert.equal(
    isSessionFresh(authTimeAt0100, new Date("invalid-date")),
    false,
    "некорректная passwordChangedAt → безопасный отказ",
  );
}

// --- verifySessionFreshness scenarios ---
async function testScenarios(): Promise<void> {
  const changed = new Date("2026-07-13T00:00:00.000Z");
  const changedSec = Math.floor(changed.getTime() / 1000);

  // passwordChangedAt = null → действительна
  {
    const { db, calls } = createMockDb({ isActive: true, passwordChangedAt: null });
    const user = await verifySessionFreshness(session(changedSec), db);
    assert.ok(user, "null passwordChangedAt → сессия действительна");
    assert.equal(user?.id, "user-xyz");
    assert.equal(calls.length, 1);
  }

  // выдан после смены → действительна
  {
    const { db } = createMockDb({ isActive: true, passwordChangedAt: changed });
    const user = await verifySessionFreshness(session(changedSec + 100), db);
    assert.ok(user, "JWT после passwordChangedAt → действителен");
  }

  // выдан до смены → отклонён
  {
    const { db } = createMockDb({ isActive: true, passwordChangedAt: changed });
    const user = await verifySessionFreshness(session(changedSec - 100), db);
    assert.equal(user, null, "JWT до passwordChangedAt → отклонён");
  }

  // неактивный пользователь → отклонён
  {
    const { db } = createMockDb({ isActive: false, passwordChangedAt: null });
    const user = await verifySessionFreshness(session(changedSec), db);
    assert.equal(user, null, "неактивный пользователь → отклонён");
  }

  // пользователь отсутствует → отклонён
  {
    const { db } = createMockDb(null);
    const user = await verifySessionFreshness(session(changedSec), db);
    assert.equal(user, null, "отсутствующий пользователь → отклонён");
  }

  // публичный/аноним → БД не трогается
  {
    const { db, calls } = createMockDb({ isActive: true, passwordChangedAt: null });
    const user = await verifySessionFreshness(null, db);
    assert.equal(user, null, "нет сессии → null");
    assert.equal(calls.length, 0, "публичный путь не обращается к БД");
  }
}

// --- ошибка БД → безопасный отказ, без PII в логах ---
async function testDbErrorFailsClosed(): Promise<void> {
  const { db, calls } = createMockDb({ isActive: true, passwordChangedAt: null }, "throw");
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };

  let result: unknown;
  try {
    result = await verifySessionFreshness(session(1000), db);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, null, "ошибка БД → безопасный отказ (доступ запрещён)");
  assert.equal(calls.length, 1);
  const joined = logged.join("\n");
  assert.match(joined, /session freshness check failed/);
  assert.doesNotMatch(joined, /secret@example\.com/, "лог не должен содержать email");
  assert.doesNotMatch(joined, /user-xyz/, "лог не должен содержать userId");
}

// --- Покрытие: guard-и на всех защищённых страницах и API ---
function listFiles(relDir: string): string[] {
  const abs = path.join(process.cwd(), relDir);
  if (!fs.existsSync(abs)) {
    return [];
  }
  return fs
    .readdirSync(abs, { recursive: true })
    .map((entry) => `${relDir}/${String(entry).replace(/\\/g, "/")}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function testCoverage(): void {
  const guardPattern = /require(Auth|Role|Owner|AdminSection)\b/;

  const protectedPages = [
    ...listFiles("src/app/admin").filter((p) => p.endsWith("page.tsx")),
    "src/app/(internal)/schedule/page.tsx",
  ];
  assert.ok(protectedPages.length >= 15, "ожидается набор защищённых страниц");
  for (const page of protectedPages) {
    assert.match(read(page), guardPattern, `защищённая страница без Node-guard: ${page}`);
  }

  // Ни один API-маршрут не читает сессию в обход guard (auth() только в chokepoint).
  const allowAuthImport = new Set([
    "src/app/api/auth/session/route.ts",
    "src/app/api/auth/[...nextauth]/route.ts",
  ]);
  const routes = listFiles("src/app/api").filter((p) => p.endsWith("route.ts"));
  for (const route of routes) {
    const src = read(route);
    if (/from "@\/auth"/.test(src) && !allowAuthImport.has(route)) {
      assert.fail(`route обращается к auth() в обход guard свежести: ${route}`);
    }
  }

  // Оба chokepoint используют проверку свежести.
  assert.match(read("src/lib/auth/session.ts"), /verifySessionFreshness\(session\)/);
  assert.match(read("src/lib/auth/api-access.ts"), /verifySessionFreshness\(session\)/);

  // Чтение сессии не пишет lastLoginAt и вообще ничего не обновляет.
  const fresh = read("src/lib/auth/session-freshness.ts");
  assert.ok(!fresh.includes("lastLoginAt"), "freshness-проверка не должна трогать lastLoginAt");
  assert.ok(!fresh.includes(".update("), "freshness-проверка не должна писать в БД");

  // Edge-безопасность: конфиг не тянет рантайм Prisma и Node-guard.
  const cfg = read("src/auth.config.ts");
  assert.ok(!cfg.includes("@/lib/db"), "auth.config.ts (edge) не должен импортировать @/lib/db");
  assert.ok(
    !cfg.includes("verifySessionFreshness"),
    "auth.config.ts (edge) не должен вызывать Node-guard",
  );

  // authTime ставится только при первичном входе (внутри `if (user)`),
  // а не при refresh JWT или чтении сессии.
  assert.match(
    cfg,
    /jwt\([^)]*\)\s*\{[\s\S]*?if \(user\) \{[\s\S]*?authTime = Math\.floor\(Date\.now\(\) \/ 1000\)[\s\S]*?\}/,
    "token.authTime должен устанавливаться только внутри блока if (user)",
  );
  const authTimeAssignments = (cfg.match(/authTime = Math\.floor\(Date\.now/g) ?? []).length;
  assert.equal(
    authTimeAssignments,
    1,
    "authTime должен присваиваться ровно один раз (только при входе), не при refresh",
  );
  assert.ok(
    !/session\.authTime = Math\.floor/.test(cfg),
    "session callback не должен пересоздавать authTime при чтении сессии",
  );
}

async function main(): Promise<void> {
  testPure();
  testSubSecondBoundary();
  await testScenarios();
  await testDbErrorFailsClosed();
  testCoverage();
  console.log("security-session-freshness-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
