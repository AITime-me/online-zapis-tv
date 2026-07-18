process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validatePasswordPolicy } from "../src/lib/auth/password-policy";
import { escapeCsvCell } from "../src/lib/csv/format-csv";
import {
  isSpreadsheetFormulaLike,
  neutralizeSpreadsheetFormulaValue,
} from "../src/lib/csv/neutralize-spreadsheet-value";
import { redactForLog } from "../src/lib/logging/redact";
import {
  createCsrfForbiddenResponse,
  enforceSameOriginForMutatingRequest,
  getTrustedAppOrigins,
  validateSameOriginRequest,
} from "../src/lib/security/csrf";
import { PUBLIC_MUTATING_API_PATHS } from "../src/lib/security/csrf-route-rules";
import { assertCsrfRouteCoverage } from "./security-csrf-coverage-check";
import {
  buildEndpointRateLimitKey,
  checkRateLimitByPolicy,
  consumeRateLimit,
  createRateLimitResponse,
  enforceRequestRateLimit,
  getRateLimitPolicy,
  getRateLimitStoreSizeForTests,
  hashRateLimitIdentity,
  MAX_RATE_LIMIT_STORE_SIZE,
  PUBLIC_RATE_LIMIT_MESSAGE,
  RATE_LIMITED_API_PATHS,
  resetRateLimitStoreForTests,
  setRateLimitClockForTests,
} from "../src/lib/security/rate-limit";

function mockHeaders(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

async function readResponseBody(response: Response): Promise<string> {
  return response.text();
}

function routeFileForPathname(pathname: string): string {
  const relative = pathname.replace(/^\/api\//, "");
  return path.join("src", "app", "api", relative, "route.ts");
}

async function runRateLimitTests(): Promise<void> {
  resetRateLimitStoreForTests();
  let now = 1_000_000;
  setRateLimitClockForTests(() => now);

  const headersA = mockHeaders({
    "user-agent": "agent-a",
    "accept-language": "ru",
  });
  const headersB = mockHeaders({
    "user-agent": "agent-b",
    "accept-language": "ru",
  });

  const policy = getRateLimitPolicy("bookingCreate");

  for (let index = 0; index < policy.maxRequests; index += 1) {
    const decision = checkRateLimitByPolicy("bookingCreate", headersA);
    assert.equal(decision.allowed, true, `request ${index + 1} should pass`);
  }

  const blocked = checkRateLimitByPolicy("bookingCreate", headersA);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  const response = createRateLimitResponse(blocked.retryAfterSeconds);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), String(blocked.retryAfterSeconds));
  const body = JSON.parse(await readResponseBody(response));
  assert.equal(body.ok, false);
  assert.equal(body.code, "RATE_LIMITED");
  assert.equal(body.error, PUBLIC_RATE_LIMIT_MESSAGE);

  const otherClient = checkRateLimitByPolicy("bookingCreate", headersB);
  assert.equal(otherClient.allowed, true);

  const keyA = buildEndpointRateLimitKey("bookingCreate", headersA);
  const keyB = buildEndpointRateLimitKey("bookingCreate", headersB);
  assert.notEqual(keyA, keyB);
  assert.doesNotMatch(keyA, /agent-a|127\.0\.0\.1|@example\.com/);

  const phoneKey = buildEndpointRateLimitKey("bookingCreate", headersA, ["79991234567"]);
  assert.notEqual(phoneKey, keyA);

  for (let index = 0; index < MAX_RATE_LIMIT_STORE_SIZE + 50; index += 1) {
    consumeRateLimit(`fill-${index}`, 60_000, 1);
  }
  assert.ok(getRateLimitStoreSizeForTests() <= MAX_RATE_LIMIT_STORE_SIZE);

  now += 120_000;
  consumeRateLimit("expired-entry", 60_000, 1);
  assert.equal(getRateLimitStoreSizeForTests() <= MAX_RATE_LIMIT_STORE_SIZE, true);
}

function runLoginThrottleDelegationTests(): void {
  const authSource = fs.readFileSync(path.join("src", "auth.ts"), "utf8");
  assert.match(
    authSource,
    /verifyCredentialsLogin/,
    "credentials-login должен использовать DB-backed verifyCredentialsLogin",
  );
  assert.doesNotMatch(
    authSource,
    /recordLoginRateLimitFailure|isLoginRateLimited/,
    "auth.ts не должен использовать in-memory login rate limit",
  );

  const loginThrottleSource = fs.readFileSync(
    path.join("src", "lib", "security", "login-throttle", "credentials-login.ts"),
    "utf8",
  );
  assert.match(loginThrottleSource, /recordLoginThrottleFailure|isLoginThrottleBlocked/, "throttle должен быть DB-backed");
  assert.match(loginThrottleSource, /LOGIN_DUMMY_BCRYPT_HASH/, "должен использоваться dummy bcrypt");
}

async function runCsrfTests(): Promise<void> {
  const trustedOrigin = getTrustedAppOrigins()[0] ?? "http://localhost:3000";

  const validRequest = new Request("http://localhost:3000/api/admin/users", {
    method: "POST",
    headers: {
      Origin: trustedOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Test" }),
  });

  assert.equal(validateSameOriginRequest(validRequest), true);
  assert.equal(enforceSameOriginForMutatingRequest(validRequest), null);

  const crossOriginRequest = new Request("http://localhost:3000/api/admin/users", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Test" }),
  });

  assert.equal(validateSameOriginRequest(crossOriginRequest), false);
  const forbidden = enforceSameOriginForMutatingRequest(crossOriginRequest);
  assert.ok(forbidden);
  assert.equal(forbidden?.status, 403);

  const crossSiteNoOrigin = new Request("http://localhost:3000/api/admin/users", {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "cross-site",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Test" }),
  });
  assert.equal(enforceSameOriginForMutatingRequest(crossSiteNoOrigin)?.status, 403);

  const noMetadata = new Request("http://localhost:3000/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test" }),
  });
  assert.equal(enforceSameOriginForMutatingRequest(noMetadata)?.status, 403);

  const getRequest = new Request("http://localhost:3000/api/admin/users", {
    method: "GET",
  });
  assert.equal(enforceSameOriginForMutatingRequest(getRequest), null);

  const publicPost = new Request("http://localhost:3000/api/booking/create", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    body: JSON.stringify({}),
  });
  assert.equal(
    PUBLIC_MUTATING_API_PATHS.has(new URL(publicPost.url).pathname),
    true,
  );

  const csrfBody = JSON.parse(await readResponseBody(createCsrfForbiddenResponse()));
  assert.equal(csrfBody.code, "CSRF_ORIGIN");
}

function runCsvNeutralizationTests(): void {
  assert.equal(
    neutralizeSpreadsheetFormulaValue("=HYPERLINK(\"http://evil\")"),
    "'=HYPERLINK(\"http://evil\")",
  );
  assert.equal(neutralizeSpreadsheetFormulaValue("+79991234567"), "'+79991234567");
  assert.equal(neutralizeSpreadsheetFormulaValue("-10"), "'-10");
  assert.equal(neutralizeSpreadsheetFormulaValue("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(
    neutralizeSpreadsheetFormulaValue("  =cmd|'/c calc'!A0"),
    "'  =cmd|'/c calc'!A0",
  );
  assert.equal(neutralizeSpreadsheetFormulaValue("Обычный текст"), "Обычный текст");
  assert.equal(isSpreadsheetFormulaLike("=1"), true);
  assert.equal(isSpreadsheetFormulaLike("текст"), false);

  const escaped = escapeCsvCell('=1+1, "quote"\nline');
  assert.match(escaped, /^"'=1\+1/);
  assert.match(escaped, /""quote""/);
}

function runPasswordPolicyTests(): void {
  assert.notEqual(validatePasswordPolicy("password123"), null);
  assert.equal(
    validatePasswordPolicy("short1A"),
    "Пароль должен содержать не менее 12 символов.",
  );
  assert.equal(validatePasswordPolicy("StrongPass123"), null);
}

function runLogRedactionTests(): void {
  const redacted = redactForLog({
    password: "secret",
    authorization: "Bearer abc",
    manageToken: "token-value",
    email: "client@example.com",
    phone: "+7 912 345-67-89",
    DATABASE_URL: "postgresql://user:pass@host/db",
    nested: {
      cookie: "session=abc",
    },
    route: "/api/booking/create",
  }) as Record<string, unknown>;

  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.equal(redacted.manageToken, "[REDACTED]");
  assert.equal(
    (redactForLog({ manageTokenHash: "abc" }) as Record<string, unknown>)
      .manageTokenHash,
    "[REDACTED]",
  );
  assert.equal(redacted.email, "[REDACTED]");
  assert.equal(redacted.phone, "[REDACTED]");
  assert.equal(redacted.DATABASE_URL, "[REDACTED]");
  assert.equal((redacted.nested as Record<string, unknown>).cookie, "[REDACTED]");
  assert.equal(redacted.route, "/api/booking/create");
}

function runHashTests(): void {
  const hashed = hashRateLimitIdentity(["policy", "part-a", "part-b"]);
  assert.equal(hashed.length, 64);
  assert.doesNotMatch(hashed, /part-a|part-b/);
}

function runRouteGuardOrderingTests(): void {
  const source = fs.readFileSync(
    path.join("src", "lib", "auth", "api-access.ts"),
    "utf8",
  );
  const guardIndex = source.indexOf("enforceSameOriginForMutatingRequest");
  const authIndex = source.indexOf("return requireApiRoles");
  assert.ok(guardIndex >= 0 && authIndex > guardIndex);
}

function runMiddlewareIsolationTests(): void {
  const middlewareSource = fs.readFileSync(
    path.join("src", "middleware.ts"),
    "utf8",
  );
  assert.doesNotMatch(middlewareSource, /rate-limit/);
  assert.match(middlewareSource, /requiresAdminCsrfProtection/);
}

function runRateLimitRouteCoverageTests(): void {
  for (const entry of RATE_LIMITED_API_PATHS) {
    const filePath = routeFileForPathname(entry.pathname);
    assert.ok(fs.existsSync(filePath), `missing route file for ${entry.pathname}`);
    const source = fs.readFileSync(filePath, "utf8");
    assert.match(
      source,
      /enforceRequestRateLimit\s*\(/,
      `${entry.pathname} must call enforceRequestRateLimit in Node handler`,
    );
  }
}

async function runServiceBypassTest(): Promise<void> {
  resetRateLimitStoreForTests();
  const policy = getRateLimitPolicy("gamePlay");
  const url = "http://localhost:3000/api/game/play";

  for (let index = 0; index < policy.maxRequests; index += 1) {
    const request = new Request(url, {
      method: "POST",
      headers: {
        "user-agent": "game-agent",
        "accept-language": "ru",
      },
    });
    assert.equal(enforceRequestRateLimit(request), null);
  }

  let serviceCalled = false;
  const blockedRequest = new Request(url, {
    method: "POST",
    headers: {
      "user-agent": "game-agent",
      "accept-language": "ru",
    },
  });

  async function handler(request: Request) {
    const limited = enforceRequestRateLimit(request);
    if (limited) {
      return limited;
    }
    serviceCalled = true;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const result = await handler(blockedRequest);
  assert.equal(result.status, 429);
  assert.equal(serviceCalled, false);
}

async function main(): Promise<void> {
  runHashTests();
  runMiddlewareIsolationTests();
  runRouteGuardOrderingTests();
  runRateLimitRouteCoverageTests();
  assertCsrfRouteCoverage();
  await runRateLimitTests();
  runLoginThrottleDelegationTests();
  await runCsrfTests();
  await runServiceBypassTest();
  runCsvNeutralizationTests();
  runPasswordPolicyTests();
  runLogRedactionTests();
  console.log("Security Batch 2A checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
