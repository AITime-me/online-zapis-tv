import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { markLastLogin } from "../src/lib/auth/last-login";

type UpdateCall = {
  where: { id: string };
  data: { lastLoginAt: Date };
  select: { id: true };
};

function createMockDb(behavior: "ok" | "throw") {
  const calls: UpdateCall[] = [];
  return {
    calls,
    db: {
      user: {
        async update(args: UpdateCall) {
          calls.push(args);
          if (behavior === "throw") {
            throw new Error("db unavailable");
          }
          return { id: args.where.id };
        },
      },
    },
  };
}

async function testSuccessfulLoginUpdates(): Promise<void> {
  const { db, calls } = createMockDb("ok");
  const now = new Date("2026-07-13T05:00:00.000Z");

  await markLastLogin("user-123", now, db);

  assert.equal(calls.length, 1, "успешный вход должен ровно один раз обновить lastLoginAt");
  assert.equal(calls[0].where.id, "user-123");
  assert.equal(calls[0].data.lastLoginAt.getTime(), now.getTime());
}

async function testEmptyUserIdSkips(): Promise<void> {
  const { db, calls } = createMockDb("ok");
  await markLastLogin("", new Date(), db);
  assert.equal(calls.length, 0, "без userId обновление не выполняется");
}

async function testUpdateErrorIsSwallowed(): Promise<void> {
  const { db, calls } = createMockDb("throw");
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };

  try {
    await assert.doesNotReject(
      markLastLogin("user-secret-id", new Date(), db),
      "ошибка обновления lastLoginAt не должна прерывать вход",
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(calls.length, 1);
  const joined = logged.join("\n");
  assert.match(joined, /failed to update lastLoginAt/);
  assert.doesNotMatch(joined, /user-secret-id/, "лог не должен содержать userId");
  assert.doesNotMatch(joined, /password|token|@/i, "лог не должен содержать секретов/email");
}

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function testWiringOnlyOnSignIn(): void {
  const authSource = readSource("src/auth.ts");

  assert.match(
    authSource,
    /events:\s*\{[\s\S]*?signIn\([\s\S]*?markLastLogin\(/,
    "markLastLogin должен вызываться из events.signIn",
  );
  assert.ok(
    !authSource.includes("lastLoginAt"),
    "authorize/callbacks не должны писать lastLoginAt напрямую — только через markLastLogin",
  );

  const configSource = readSource("src/auth.config.ts");
  // Edge-config не должен писать lastLoginAt, дёргать markLastLogin, тянуть
  // рантайм-клиент Prisma (@/lib/db) или вешать events-обработчик со side effects.
  for (const forbidden of ["lastLoginAt", "markLastLogin", "@/lib/db", "events"]) {
    assert.ok(
      !configSource.includes(forbidden),
      `auth.config.ts (edge middleware) не должен содержать "${forbidden}"`,
    );
  }
}

async function main(): Promise<void> {
  await testSuccessfulLoginUpdates();
  await testEmptyUserIdSkips();
  await testUpdateErrorIsSwallowed();
  testWiringOnlyOnSignIn();
  console.log("security-last-login-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
