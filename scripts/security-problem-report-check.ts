/**
 * Security/contract + unit checks for website problem reports.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildProblemReportMeta,
  encodeProblemReportComment,
  parseProblemReportComment,
  sanitizeProblemReportPagePath,
  validateProblemReportInput,
  hasProblemReportFieldErrors,
} from "../src/lib/problem-report/validation";
import { formatProblemReportTelegramMessage } from "../src/lib/problem-report/telegram-message";
import { PROBLEM_REPORT_SOURCE } from "../src/lib/problem-report/constants";
import { resolveApiRateLimitPolicy } from "../src/lib/security/rate-limit/route-rules";
import { RATE_LIMIT_POLICIES } from "../src/lib/security/rate-limit/policies";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertSchemaAndMigration(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /WEBSITE_PROBLEM_REPORT/);
  assert.match(
    schema,
    /enum BookingRequestType \{[\s\S]*WEBSITE_PROBLEM_REPORT/,
  );
  assert.match(
    schema,
    /enum BookingRequestSource \{[\s\S]*WEBSITE_PROBLEM_REPORT/,
  );
  assert.match(
    schema,
    /enum LegalAcceptanceSource \{[\s\S]*WEBSITE_PROBLEM_REPORT/,
  );

  const migration = read(
    "prisma/migrations/20260731120000_website_problem_report/migration.sql",
  );
  assert.match(migration, /WEBSITE_PROBLEM_REPORT/);
}

function assertValidationAndSanitization(): void {
  const valid = validateProblemReportInput({
    clientName: "Анна",
    clientPhone: "+79991234567",
    description: "Не открывается запись",
    personalDataConsent: true,
    pagePath: "/booking",
    userAgent: "Mozilla/5.0",
    viewportWidth: 360,
    viewportHeight: 740,
  });
  assert.equal(hasProblemReportFieldErrors(valid), false);

  const badPhone = validateProblemReportInput({
    clientName: "",
    clientPhone: "123",
    description: "Не открывается запись",
    personalDataConsent: true,
    pagePath: "/booking",
    userAgent: "",
    viewportWidth: 0,
    viewportHeight: 0,
  });
  assert.ok(badPhone.phone);

  const badDesc = validateProblemReportInput({
    clientName: "",
    clientPhone: "+79991234567",
    description: "ab",
    personalDataConsent: true,
    pagePath: "/booking",
    userAgent: "",
    viewportWidth: 0,
    viewportHeight: 0,
  });
  assert.ok(badDesc.description);

  const noConsent = validateProblemReportInput({
    clientName: "",
    clientPhone: "+79991234567",
    description: "Проблема с формой",
    personalDataConsent: false,
    pagePath: "/booking",
    userAgent: "",
    viewportWidth: 0,
    viewportHeight: 0,
  });
  assert.ok(noConsent.personalDataConsent);

  assert.equal(
    sanitizeProblemReportPagePath("/booking?token=secret&utm=1"),
    "/booking",
  );
  assert.equal(
    sanitizeProblemReportPagePath("/manage?manageToken=abc&x=1#frag"),
    "/manage",
  );
  assert.equal(sanitizeProblemReportPagePath("https://evil.example/x"), "/booking");
  assert.equal(sanitizeProblemReportPagePath("//evil"), "/booking");

  const meta = buildProblemReportMeta({
    pagePath: "/booking?token=nope",
    userAgent: "Mozilla/5.0 (iPhone) Safari/605",
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.equal(meta.source, PROBLEM_REPORT_SOURCE);
  assert.equal(meta.pagePath, "/booking");
  assert.doesNotMatch(meta.pagePath, /token/);

  const encoded = encodeProblemReportComment("Сломалась кнопка", meta);
  const parsed = parseProblemReportComment(encoded);
  assert.equal(parsed.description, "Сломалась кнопка");
  assert.equal(parsed.meta?.pagePath, "/booking");
  assert.equal(parsed.meta?.viewportWidth, 390);
}

function assertTelegramFormattingAndFailSafe(): void {
  const message = formatProblemReportTelegramMessage({
    requestId: "req-1",
    clientName: "Анна <script>",
    clientPhone: "+79991234567",
    description: "Не работает форма\nвторая строка",
    createdAt: new Date("2026-07-31T10:00:00.000Z"),
    meta: {
      source: PROBLEM_REPORT_SOURCE,
      pagePath: "/booking",
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120",
      viewportWidth: 360,
      viewportHeight: 740,
    },
  });

  assert.match(message, /^Проблема на сайте/m);
  assert.match(message, /Анна <script>/);
  assert.match(message, /\+79991234567/);
  assert.match(message, /Не работает форма/);
  assert.match(message, /Страница: \/booking/);
  assert.match(message, /ID обращения: req-1/);
  assert.match(message, /Chrome \/ Android/);

  const service = read("src/services/ProblemReportService.ts");
  assert.match(service, /sendProblemReportTelegramNotification/);
  assert.match(service, /clientId:\s*null/);
  assert.match(service, /appointmentId:\s*null/);
  assert.match(service, /type:\s*"WEBSITE_PROBLEM_REPORT"/);
  assert.match(service, /source:\s*"WEBSITE_PROBLEM_REPORT"/);
  const telegramCallIndex = service.indexOf(
    "await sendProblemReportTelegramNotification",
  );
  const createIndex = service.indexOf("bookingRequest.create");
  assert.ok(createIndex >= 0 && telegramCallIndex > createIndex);

  const telegram = read("src/lib/problem-report/telegram.ts");
  assert.match(telegram, /PROBLEM_REPORT_TELEGRAM_BOT_TOKEN/);
  assert.match(telegram, /PROBLEM_REPORT_TELEGRAM_CHAT_ID/);
  assert.match(telegram, /missing_env/);
  assert.doesNotMatch(
    telegram,
    /console\.(?:log|warn|error)\([^)]*process\.env\.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN/,
  );
  assert.match(telegram, /TELEGRAM_TIMEOUT_MS/);
}

async function assertTelegramSendMock(): Promise<void> {
  const { createRequire } = await import("node:module");
  const require = createRequire(
    `${process.cwd()}/scripts/security-problem-report-check.ts`,
  );
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };

  // Re-import after env/mocks: bust module cache for telegram.
  const telegramModulePath = require.resolve("../src/lib/problem-report/telegram");
  delete require.cache[telegramModulePath];

  const prevToken = process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID;
  delete process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN;
  delete process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID;

  const { sendProblemReportTelegramNotification } = await import(
    "../src/lib/problem-report/telegram"
  );

  const payload = {
    requestId: "req-mock",
    clientName: "Тест",
    clientPhone: "+79990001122",
    description: "Описание",
    createdAt: new Date("2026-07-31T12:00:00.000Z"),
    meta: {
      source: PROBLEM_REPORT_SOURCE,
      pagePath: "/booking",
      userAgent: "Mozilla/5.0",
      viewportWidth: 360,
      viewportHeight: 640,
    },
  } as const;

  const FAKE_TOKEN = "000000:FAKE-TOKEN-TEST-ONLY";
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const missing = await sendProblemReportTelegramNotification(payload, async () => {
      throw new Error("should not call telegram when env missing");
    });
    assert.deepEqual(missing, { ok: true, skipped: true, reason: "missing_env" });

    process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID = "12345";

    let capturedUrl = "";
    let capturedBody = "";
    const okSend = await sendProblemReportTelegramNotification(
      payload,
      async (input, init) => {
        capturedUrl = String(input);
        capturedBody = String(init?.body ?? "");
        assert.match(capturedUrl, /api\.telegram\.org\/bot/);
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
        });
      },
    );
    assert.deepEqual(okSend, { ok: true, skipped: false });
    assert.match(capturedBody, /Проблема на сайте/);
    assert.match(capturedBody, /req-mock/);

    warnings.length = 0;
    const apiFalse = await sendProblemReportTelegramNotification(
      payload,
      async () =>
        new Response(JSON.stringify({ ok: false, description: "Bad Request" }), {
          status: 200,
        }),
    );
    assert.deepEqual(apiFalse, {
      ok: false,
      skipped: false,
      error: "api_ok_false",
    });
    assert.ok(warnings.some((line) => /api_ok_false/.test(line)));

    warnings.length = 0;
    const malformed = await sendProblemReportTelegramNotification(
      payload,
      async () => new Response("not-json{", { status: 200 }),
    );
    assert.deepEqual(malformed, {
      ok: false,
      skipped: false,
      error: "malformed_json",
    });
    assert.ok(warnings.some((line) => /malformed_json/.test(line)));

    warnings.length = 0;
    const httpFail = await sendProblemReportTelegramNotification(
      payload,
      async () => new Response("fail", { status: 500 }),
    );
    assert.deepEqual(httpFail, {
      ok: false,
      skipped: false,
      error: "http_500",
    });
    assert.ok(warnings.some((line) => /HTTP 500/.test(line)));

    warnings.length = 0;
    const timeout = await sendProblemReportTelegramNotification(
      payload,
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (signal.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
            return;
          }
          signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    assert.deepEqual(timeout, { ok: false, skipped: false, error: "timeout" });
    assert.ok(warnings.some((line) => /timeout/.test(line)));

    const joined = warnings.join("\n");
    assert.doesNotMatch(joined, new RegExp(FAKE_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(joined, /api\.telegram\.org\/bot\S+/);
  } finally {
    console.warn = originalWarn;
    if (prevToken === undefined) delete process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN;
    else process.env.PROBLEM_REPORT_TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChat === undefined) delete process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID;
    else process.env.PROBLEM_REPORT_TELEGRAM_CHAT_ID = prevChat;
  }
}

function assertRouteSecurity(): void {
  const route = read("src/app/api/booking/problem-report/route.ts");
  assert.match(route, /enforceRequestRateLimit/);
  assert.match(route, /enforceSameOriginForMutatingRequest/);
  assert.match(route, /enforceValidatedPhoneRateLimit/);
  assert.match(route, /body\.status !== undefined/);
  assert.match(route, /body\.type !== undefined/);
  assert.match(route, /body\.clientId !== undefined/);
  assert.match(route, /body\.appointmentId !== undefined/);
  assert.match(route, /createWebsiteProblemReport/);
  assert.doesNotMatch(route, /createClient|Appointment/);

  assert.equal(
    resolveApiRateLimitPolicy("/api/booking/problem-report", "POST"),
    "problemReport",
  );
  assert.equal(RATE_LIMIT_POLICIES.problemReport.maxRequests, 5);

  const scheduleList = read("src/services/BookingRequestService.ts");
  assert.match(
    scheduleList,
    /type:\s*\{\s*not:\s*"WEBSITE_PROBLEM_REPORT"\s*\}/,
  );

  const labels = read("src/lib/booking-requests/booking-request-contract.ts");
  assert.match(labels, /WEBSITE_PROBLEM_REPORT:\s*"Проблема на сайте"/);

  const ui = read("src/components/booking/report-problem-form.tsx");
  assert.match(ui, /aria-modal/);
  assert.match(ui, /aria-labelledby/);
  assert.match(ui, /Escape/);
  assert.match(ui, /pendingRef/);
  assert.match(ui, /submitLockRef/);
  assert.match(ui, /Спасибо! Сообщение отправлено/);
  assert.match(ui, /focusables/);
  assert.doesNotMatch(
    ui,
    /}, \[onClose, pending\]\)/,
    "pending must not re-run mount focus/scroll effect",
  );
  assert.match(
    ui,
    /document\.body\.style\.overflow = "hidden";[\s\S]*\}, \[\]\);/,
    "body scroll lock must be mount-only",
  );

  const constants = read("src/lib/problem-report/constants.ts");
  assert.doesNotMatch(constants, /PROBLEM_REPORT_SECRET_QUERY_KEYS/);

  const telegram = read("src/lib/problem-report/telegram.ts");
  assert.match(telegram, /api_ok_false|malformed_json/);
  assert.match(telegram, /\.ok !== true/);

  const bookingPage = read("src/app/booking/page.tsx");
  assert.match(bookingPage, /ReportProblemEntry/);

  const envExample = read(".env.example");
  assert.match(envExample, /PROBLEM_REPORT_TELEGRAM_BOT_TOKEN/);
  assert.match(envExample, /PROBLEM_REPORT_TELEGRAM_CHAT_ID/);
}

async function main(): Promise<void> {
  assertSchemaAndMigration();
  assertValidationAndSanitization();
  assertTelegramFormattingAndFailSafe();
  await assertTelegramSendMock();
  assertRouteSecurity();
  console.log("security-problem-report-check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
