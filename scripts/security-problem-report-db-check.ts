/**
 * Isolated PostgreSQL integration for website problem reports.
 *
 * Opt-in only:
 *   RUN_PROBLEM_REPORT_DB_TESTS=1
 *   DB_TEST_TARGET=isolated
 *   DATABASE_URL=postgresql://...@127.0.0.1:<port>/...
 *
 * Refuses staging/production hostnames. Does not touch remote DBs.
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const RUN_FLAG = "RUN_PROBLEM_REPORT_DB_TESTS";
const TARGET_FLAG = "DB_TEST_TARGET";

if (process.env[RUN_FLAG] !== "1") {
  console.log(
    "security-problem-report-db-check: SKIPPED (set RUN_PROBLEM_REPORT_DB_TESTS=1)",
  );
  process.exit(0);
}

if (process.env[TARGET_FLAG] !== "isolated") {
  throw new Error("DB integration refused: DB_TEST_TARGET must be exactly isolated");
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) {
  throw new Error("DB integration refused: DATABASE_URL is required");
}

const forbiddenHostHints = [
  "staging",
  "production",
  "prod",
  "timeweb",
  "tvoe-vremya",
  "amazonaws",
  "neon.tech",
  "supabase",
];
const parsedUrl = new URL(databaseUrl);
const host = parsedUrl.hostname.toLowerCase();
if (
  host !== "127.0.0.1" &&
  host !== "localhost" &&
  host !== "::1"
) {
  throw new Error(
    `DB integration refused: host must be loopback, got ${parsedUrl.hostname}`,
  );
}
for (const hint of forbiddenHostHints) {
  if (databaseUrl.toLowerCase().includes(hint)) {
    throw new Error(`DB integration refused: DATABASE_URL looks like ${hint}`);
  }
}

const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function seedPublishedConsent(
  prisma: import("@prisma/client").PrismaClient,
): Promise<void> {
  const existing = await prisma.legalDocument.findUnique({
    where: { slug: "consent" },
    include: { currentPublishedVersion: true },
  });
  if (existing?.currentPublishedVersion?.status === "PUBLISHED") {
    return;
  }

  const content = "Тестовое согласие на обработку персональных данных.";
  const hash = contentHash(content);

  if (!existing) {
    const created = await prisma.legalDocument.create({
      data: {
        slug: "consent",
        title: "Согласие",
        publicPath: "/consent",
        content,
        isPublished: true,
        versions: {
          create: {
            versionNumber: 1,
            title: "Согласие",
            content,
            contentHash: hash,
            status: "PUBLISHED",
            publishedAt: new Date(),
          },
        },
      },
      include: { versions: true },
    });
    await prisma.legalDocument.update({
      where: { id: created.id },
      data: { currentPublishedVersionId: created.versions[0]!.id },
    });
    return;
  }

  const version = await prisma.legalDocumentVersion.create({
    data: {
      documentId: existing.id,
      versionNumber: (existing.currentPublishedVersion?.versionNumber ?? 0) + 1,
      title: "Согласие",
      content,
      contentHash: hash,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  await prisma.legalDocument.update({
    where: { id: existing.id },
    data: {
      isPublished: true,
      currentPublishedVersionId: version.id,
      content,
    },
  });
}

async function main(): Promise<void> {
  const [{ prisma }, problemReportService, telegramModule, validation, bookingRequestService, permissions, rateLimitStore, enforcePolicy, routeModule] =
    await Promise.all([
      import("../src/lib/db"),
      import("../src/services/ProblemReportService"),
      import("../src/lib/problem-report/telegram"),
      import("../src/lib/problem-report/validation"),
      import("../src/services/BookingRequestService"),
      import("../src/lib/auth/permissions"),
      import("../src/lib/security/rate-limit/store"),
      import("../src/lib/security/rate-limit/enforce-policy"),
      import("../src/app/api/booking/problem-report/route"),
    ]);

  await seedPublishedConsent(prisma);

  const beforeClients = await prisma.client.count();
  const beforeAppointments = await prisma.appointment.count();
  const beforeManagerRequests = await prisma.bookingRequest.count({
    where: { type: { in: ["MANAGER_REQUEST", "CONSULTATION_REQUEST"] } },
  });

  // Missing Telegram env must not block persistence.
  delete process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN;
  delete process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID;

  const created = await problemReportService.createWebsiteProblemReport({
    clientName: "Анна DB",
    clientPhone: "+79991234567",
    description: "Кнопка записи не отвечает на мобильном",
    personalDataConsent: true,
    pagePath: "/booking?token=secret&utm=1#frag",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605",
    viewportWidth: 390,
    viewportHeight: 844,
  });

  assert.ok(created.id);
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const row = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id: created.id },
  });
  assert.equal(row.type, "WEBSITE_PROBLEM_REPORT");
  assert.equal(row.source, "WEBSITE_PROBLEM_REPORT");
  assert.equal(row.status, "NEW");
  assert.equal(row.clientId, null);
  assert.equal(row.appointmentId, null);
  assert.equal(row.masterId, null);
  assert.equal(row.clientName, "Анна DB");
  assert.equal(row.clientPhone, "+79991234567");

  const parsed = validation.parseProblemReportComment(row.comment);
  assert.equal(parsed.description, "Кнопка записи не отвечает на мобильном");
  assert.equal(parsed.meta?.pagePath, "/booking");
  assert.doesNotMatch(row.comment ?? "", /token=|utm=|#frag/);

  assert.equal(await prisma.client.count(), beforeClients);
  assert.equal(await prisma.appointment.count(), beforeAppointments);
  assert.equal(
    await prisma.bookingRequest.count({
      where: { type: { in: ["MANAGER_REQUEST", "CONSULTATION_REQUEST"] } },
    }),
    beforeManagerRequests,
  );

  // Legal acceptance recorded.
  const acceptance = await prisma.legalAcceptanceRecord.findFirst({
    where: {
      bookingRequestId: created.id,
      source: "WEBSITE_PROBLEM_REPORT",
      acceptanceType: "PERSONAL_DATA_CONSENT",
    },
  });
  assert.ok(acceptance);

  // OWNER/MANAGER can list; MASTER cannot access admin section.
  assert.equal(permissions.canAccessAdminSection("OWNER", "booking-requests"), true);
  assert.equal(permissions.canAccessAdminSection("MANAGER", "booking-requests"), true);
  assert.equal(permissions.canAccessAdminSection("MASTER", "booking-requests"), false);

  const listed = await bookingRequestService.listBookingRequestsPaginated({
    section: "active",
    page: 1,
    pageSize: 50,
    statusFilter: "NEW",
  });
  assert.ok(listed.requests.some((item) => item.id === created.id));

  // Must not appear in schedule active bucket.
  const scheduleRows = await bookingRequestService.listActiveBookingRequestsForRange(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
    new Date(Date.now() + 24 * 60 * 60 * 1000),
    "full",
  );
  assert.equal(
    scheduleRows.some((item) => item.id === created.id),
    false,
  );

  // Legacy comment without marker must parse fail-safe.
  const legacy = validation.parseProblemReportComment("просто текст без маркера");
  assert.equal(legacy.meta, null);
  assert.equal(legacy.description, "просто текст без маркера");

  // Reject privileged fields via public route.
  const forged = await routeModule.POST(
    new Request("http://127.0.0.1/api/booking/problem-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        host: "127.0.0.1:3000",
      },
      body: JSON.stringify({
        clientName: "Hack",
        clientPhone: "+79990001122",
        description: "attempt",
        personalDataConsent: true,
        pagePath: "/booking",
        type: "MANAGER_REQUEST",
        source: "ONLINE",
        status: "CLOSED",
        role: "OWNER",
        recipient: "admin",
        clientId: randomUUID(),
        appointmentId: randomUUID(),
      }),
    }),
  );
  assert.equal(forged.status, 400);
  const forgedJson = (await forged.json()) as { ok?: boolean };
  assert.equal(forgedJson.ok, false);

  // Validation rejects bad phone / short description / huge viewport already clamped.
  await assert.rejects(
    () =>
      problemReportService.createWebsiteProblemReport({
        clientName: "",
        clientPhone: "123",
        description: "Нормальное описание проблемы",
        personalDataConsent: true,
        pagePath: "/booking",
        userAgent: "",
        viewportWidth: 360,
        viewportHeight: 640,
      }),
    /телефон|номер/i,
  );
  await assert.rejects(
    () =>
      problemReportService.createWebsiteProblemReport({
        clientName: "",
        clientPhone: "+79991234567",
        description: "ab",
        personalDataConsent: true,
        pagePath: "/booking",
        userAgent: "",
        viewportWidth: 360,
        viewportHeight: 640,
      }),
    /Опишите проблему/,
  );

  // Telegram failure after commit must not undo row / must not throw to caller.
  process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN = "000000:FAKE-TOKEN-DB-TEST";
  process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID = "42";
  const beforeFail = await prisma.bookingRequest.count({
    where: { type: "WEBSITE_PROBLEM_REPORT" },
  });
  const afterFailTelegram = await problemReportService.createWebsiteProblemReport({
    clientName: "Telegram Fail",
    clientPhone: "+79995556677",
    description: "Проверка fail-safe Telegram",
    personalDataConsent: true,
    pagePath: "/booking",
    userAgent: "Mozilla/5.0",
    viewportWidth: 360,
    viewportHeight: 640,
  });
  // Monkey-patch already happened inside service with real fetch to telegram - may fail network.
  // Explicit unit of send:
  const sendResult = await telegramModule.sendProblemReportTelegramNotification(
    {
      requestId: afterFailTelegram.id,
      clientName: "X",
      clientPhone: "+79995556677",
      description: "y",
      createdAt: new Date(),
      meta: {
        source: "website_problem_report",
        pagePath: "/booking",
        userAgent: "ua",
        viewportWidth: 1,
        viewportHeight: 1,
      },
    },
    async () => new Response("nope", { status: 500 }),
  );
  assert.equal(sendResult.ok, false);
  assert.ok(
    await prisma.bookingRequest.findUnique({ where: { id: afterFailTelegram.id } }),
  );
  assert.equal(
    await prisma.bookingRequest.count({ where: { type: "WEBSITE_PROBLEM_REPORT" } }),
    beforeFail + 1,
  );

  const timeoutResult = await telegramModule.sendProblemReportTelegramNotification(
    {
      requestId: "timeout-id",
      clientName: "X",
      clientPhone: "+79995556677",
      description: "y",
      createdAt: new Date(),
      meta: {
        source: "website_problem_report",
        pagePath: "/booking",
        userAgent: "ua",
        viewportWidth: 1,
        viewportHeight: 1,
      },
    },
    async (_input, init) => {
      const signal = init?.signal;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 10_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      return new Response("{}", { status: 200 });
    },
  );
  assert.equal(timeoutResult.ok, false);

  // Rate limit: first allowed, flood rejected.
  rateLimitStore.resetRateLimitStoreForTests();
  const makeReq = () =>
    new Request("http://127.0.0.1/api/booking/problem-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        host: "127.0.0.1:3000",
        "x-forwarded-for": "203.0.113.50",
      },
    });

  let saw429 = false;
  for (let i = 0; i < 8; i += 1) {
    const limited = enforcePolicy.enforceRequestRateLimit(makeReq());
    if (limited) {
      assert.equal(limited.status, 429);
      saw429 = true;
      break;
    }
  }
  assert.equal(saw429, true, "rate limit must reject after policy max");

  // First request after reset still allowed.
  rateLimitStore.resetRateLimitStoreForTests();
  assert.equal(enforcePolicy.enforceRequestRateLimit(makeReq()), null);

  console.log("security-problem-report-db-check: OK");
  console.log(
    JSON.stringify({
      database: `${parsedUrl.hostname}:${parsedUrl.port}${parsedUrl.pathname}`,
      createdId: created.id,
      telegramFailSafeId: afterFailTelegram.id,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
