/**
 * BOT-CLOSED-TEST-01B — admin closed-test console + server-only Bot Core proxy.
 *
 * Covers: OWNER roles, TEST+enabled gate, mode denies, missing config fail-closed,
 * token only server-side, safe upstream status mapping, UI visibility, secret hygiene.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  deriveClosedTestPipelineOutcome,
  mapUpstreamStatusToAdminError,
  projectSafeSyntheticResult,
  sanitizeClosedTestAck,
  sanitizeClosedTestStatus,
  validateClosedTestCreateInput,
} from "../src/lib/bot-core/closed-test-contract";
import {
  evaluateClosedTestAdminGate,
  isClosedTestConsoleVisible,
} from "../src/lib/bot-core/closed-test-gate";
import {
  BOT_SETTINGS_EDIT_ROLES,
  BOT_SETTINGS_VIEW_ROLES,
} from "../src/lib/auth/api-access";
import { OWNER_ROLES } from "../src/lib/auth/permissions";
import { requiresAdminCsrfProtection } from "../src/lib/security/csrf-route-rules";

process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

const TOKEN =
  "closed-test-01b-token-value-32chars-min-ok";
const BASE = "http://127.0.0.1:18080";

assert.ok(TOKEN.length >= 32);

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function withEnv<T>(
  env: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(env)) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assertSourceContracts(): void {
  const postRoute = read("src/app/api/admin/bot/closed-test/events/route.ts");
  const getRoute = read(
    "src/app/api/admin/bot/closed-test/events/[eventId]/route.ts",
  );
  const client = read("src/lib/bot-core/closed-test-client.ts");
  const config = read("src/lib/bot-core/closed-test-config.ts");
  const consoleUi = read("src/components/admin/bot-closed-test-console.tsx");
  const panel = read("src/components/admin/bot-settings-panel.tsx");
  const envExample = read(".env.example");

  assert.match(postRoute, /requireProtectedMutatingApi/);
  assert.match(postRoute, /BOT_SETTINGS_EDIT_ROLES/);
  assert.match(postRoute, /requireClosedTestAdminAccess/);
  assert.match(getRoute, /requireApiRoles/);
  assert.match(getRoute, /BOT_SETTINGS_VIEW_ROLES/);
  assert.match(client, /server-only/);
  assert.match(config, /server-only/);
  assert.match(client, /X-Bot-Closed-Test-Token|BOT_CLOSED_TEST_TOKEN_HEADER/);
  assert.match(client, /redirect:\s*["']error["']/);
  assert.match(client, /isRedirectStatus|rejectUpstreamRedirect/);
  assert.doesNotMatch(consoleUi, /BOT_CLOSED_TEST_TOKEN|BOT_CORE_INTERNAL_URL/);
  assert.doesNotMatch(consoleUi, /NEXT_PUBLIC_/);
  assert.doesNotMatch(consoleUi, /18080|internal\/closed-test/);
  assert.match(consoleUi, /не ответ модели|не AI-ответ|Не.*AI/i);
  assert.match(panel, /isClosedTestConsoleVisible/);
  assert.match(panel, /BotClosedTestConsole/);
  assert.match(envExample, /BOT_CORE_INTERNAL_URL/);
  assert.match(envExample, /BOT_CLOSED_TEST_TOKEN/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_BOT_CLOSED_TEST/);

  // Token must not be echoed in warn helpers.
  assert.match(client, /Never log token/);
  assert.doesNotMatch(
    client.replace(/\/\/.*$/gm, ""),
    /console\.(?:log|warn|error)\([^)]*config\.token/,
  );

  assert.deepEqual(BOT_SETTINGS_EDIT_ROLES, OWNER_ROLES);
  assert.deepEqual(BOT_SETTINGS_VIEW_ROLES, OWNER_ROLES);
  assert.equal(
    requiresAdminCsrfProtection("/api/admin/bot/closed-test/events", "POST"),
    true,
  );
}

function assertPollingRegressionGuard(): void {
  const consoleUi = read("src/components/admin/bot-closed-test-console.tsx");
  assert.match(consoleUi, /const POLL_MAX_ATTEMPTS\s*=\s*([1-9]\d*)\b/);
  const maxMatch = consoleUi.match(/const POLL_MAX_ATTEMPTS\s*=\s*([1-9]\d*)\b/);
  assert.ok(maxMatch);
  assert.ok(Number(maxMatch[1]) <= 120, "poll max attempts must stay bounded");
  assert.match(
    consoleUi,
    /for\s*\(\s*let\s+attempt\s*=\s*0;\s*attempt\s*<\s*POLL_MAX_ATTEMPTS/,
  );
  assert.match(
    consoleUi,
    /if\s*\(\s*payload\.status\.pipelineTerminal\s*\)\s*\{[\s\S]*?\breturn;/,
  );
}

function assertComposeWiring(): void {
  for (const file of [
    "docker-compose.staging.yml",
    "docker-compose.production.yml",
  ]) {
    const compose = read(file);
    assert.match(
      compose,
      /^\s*BOT_CORE_INTERNAL_URL:\s*\$\{BOT_CORE_INTERNAL_URL:-\}\s*$/m,
    );
    assert.match(
      compose,
      /^\s*BOT_CLOSED_TEST_TOKEN:\s*\$\{BOT_CLOSED_TEST_TOKEN:-\}\s*$/m,
    );
    assert.doesNotMatch(
      compose,
      /^\s*BOT_CLOSED_TEST_TOKEN:\s*[^$\s#]/m,
    );
    assert.doesNotMatch(compose, /NEXT_PUBLIC_BOT_CLOSED_TEST/);
  }
}

function assertGate(): void {
  assert.deepEqual(
    evaluateClosedTestAdminGate({ mode: "TEST", isEnabled: true }),
    { ok: true },
  );
  assert.equal(isClosedTestConsoleVisible({ mode: "TEST", isEnabled: true }), true);

  for (const mode of ["OFF", "HINTS", "DRAFT", "AUTO"] as const) {
    const denied = evaluateClosedTestAdminGate({ mode, isEnabled: true });
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.code, "CLOSED_TEST_MODE_REQUIRED");
    }
    assert.equal(isClosedTestConsoleVisible({ mode, isEnabled: true }), false);
  }

  const disabled = evaluateClosedTestAdminGate({
    mode: "TEST",
    isEnabled: false,
  });
  assert.equal(disabled.ok, false);
  if (!disabled.ok) {
    assert.equal(disabled.code, "CLOSED_TEST_NOT_ENABLED");
  }
}

async function assertConfigFailClosed(): Promise<void> {
  const { readClosedTestUpstreamConfig, ClosedTestUpstreamConfigError } =
    await import("../src/lib/bot-core/closed-test-config");

  withEnv(
    { BOT_CORE_INTERNAL_URL: undefined, BOT_CLOSED_TEST_TOKEN: undefined },
    () => {
      assert.throws(
        () => readClosedTestUpstreamConfig(),
        (error: unknown) =>
          error instanceof ClosedTestUpstreamConfigError &&
          error.code === "CLOSED_TEST_UPSTREAM_UNCONFIGURED",
      );
    },
  );

  withEnv(
    { BOT_CORE_INTERNAL_URL: "not-a-url", BOT_CLOSED_TEST_TOKEN: TOKEN },
    () => {
      assert.throws(
        () => readClosedTestUpstreamConfig(),
        (error: unknown) =>
          error instanceof ClosedTestUpstreamConfigError &&
          error.code === "CLOSED_TEST_UPSTREAM_URL_INVALID",
      );
    },
  );

  withEnv(
    { BOT_CORE_INTERNAL_URL: BASE, BOT_CLOSED_TEST_TOKEN: "short" },
    () => {
      assert.throws(
        () => readClosedTestUpstreamConfig(),
        (error: unknown) =>
          error instanceof ClosedTestUpstreamConfigError &&
          error.code === "CLOSED_TEST_UPSTREAM_TOKEN_INVALID",
      );
    },
  );

  const cfg = withEnv(
    { BOT_CORE_INTERNAL_URL: `${BASE}/`, BOT_CLOSED_TEST_TOKEN: TOKEN },
    () => readClosedTestUpstreamConfig(),
  );
  assert.equal(cfg.baseUrl, BASE);
  assert.equal(cfg.token, TOKEN);
  assert.equal(String(cfg).includes(TOKEN), false);
}

async function assertProxyTokenServerSideOnly(): Promise<void> {
  const { readClosedTestUpstreamConfig } = await import(
    "../src/lib/bot-core/closed-test-config"
  );
  const { postClosedTestEventUpstream, getClosedTestEventUpstream } =
    await import("../src/lib/bot-core/closed-test-client");

  const config = withEnv(
    { BOT_CORE_INTERNAL_URL: BASE, BOT_CLOSED_TEST_TOKEN: TOKEN },
    () => readClosedTestUpstreamConfig(),
  );

  const eventId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  let sawTokenHeader = false;
  let leakedToClientPayload = false;

  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const tokenHeader = headers.get("X-Bot-Closed-Test-Token");
    if (tokenHeader === TOKEN) {
      sawTokenHeader = true;
    }
    const url = String(input);
    assert.doesNotMatch(url, new RegExp(TOKEN));
    assert.equal(headers.get("Authorization"), null);
    assert.equal(init?.redirect, "error");

    if (init?.method === "POST") {
      return new Response(
        JSON.stringify({
          accepted: true,
          duplicate: false,
          event_id: eventId,
          status: "RECEIVED",
          correlation_id: "ffffffff-1111-4222-8333-444444444444",
          secret_echo: TOKEN,
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        event_id: eventId,
        correlation_id: "ffffffff-1111-4222-8333-444444444444",
        ingress: { status: "PROCESSED", channel: "synthetic" },
        inbound: { present: true, processing_status: "PROCESSED" },
        reply_plan: {
          present: true,
          reply_plan_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
          status: "DISPATCHED",
          context_version: 1,
        },
        outbound: {
          present: true,
          destination_type: "SYNTHETIC_OUTBOUND",
          delivery_status: "DELIVERED",
          outbound_id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
        },
        synthetic_result: {
          schema: "synthetic.outbound.v1",
          synthetic_token: "SYNTHETIC_OK",
          password: TOKEN,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const post = await postClosedTestEventUpstream(
    config,
    {
      sessionId: "session_1",
      requestId: "req_1",
      text: "hello closed test",
    },
    fetchImpl,
  );
  assert.equal(post.ok, true);
  if (post.ok) {
    const serialized = JSON.stringify(post.data);
    if (serialized.includes(TOKEN)) {
      leakedToClientPayload = true;
    }
    assert.equal(post.data.eventId, eventId);
    assert.equal(post.status, 202);
  }

  const get = await getClosedTestEventUpstream(config, eventId, fetchImpl);
  assert.equal(get.ok, true);
  if (get.ok) {
    const serialized = JSON.stringify(get.data);
    if (serialized.includes(TOKEN)) {
      leakedToClientPayload = true;
    }
    assert.equal(get.data.pipelineOutcome, "delivered");
    assert.equal(get.data.syntheticResult?.syntheticToken, "SYNTHETIC_OK");
    assert.equal(
      (get.data.syntheticResult as { password?: string } | null)?.password,
      undefined,
    );
  }

  assert.equal(sawTokenHeader, true);
  assert.equal(leakedToClientPayload, false);
}

function assertUpstreamStatusMapping(): void {
  assert.equal(mapUpstreamStatusToAdminError(422, { detail: "VALIDATION_ERROR" }).status, 422);
  assert.equal(mapUpstreamStatusToAdminError(409, { detail: "IDEMPOTENCY_CONFLICT" }).status, 409);
  assert.equal(mapUpstreamStatusToAdminError(404, { detail: "NOT_FOUND" }).status, 404);
  assert.equal(mapUpstreamStatusToAdminError(503, { detail: "INGRESS_UNAVAILABLE" }).status, 503);
  assert.equal(mapUpstreamStatusToAdminError(401, { detail: "UNAUTHORIZED" }).status, 503);

  const ack = sanitizeClosedTestAck({
    accepted: true,
    duplicate: false,
    event_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    status: "RECEIVED",
    correlation_id: "ffffffff-1111-4222-8333-444444444444",
    text: "should-not-pass",
  });
  assert.ok(ack);
  assert.equal("text" in ack, false);

  const status = sanitizeClosedTestStatus({
    event_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    correlation_id: "ffffffff-1111-4222-8333-444444444444",
    ingress: { status: "DEAD", channel: "synthetic" },
    inbound: null,
    reply_plan: null,
    outbound: null,
    synthetic_result: null,
  });
  assert.ok(status);
  assert.equal(status.pipelineTerminal, true);
  assert.equal(status.pipelineOutcome, "failed");

  assert.deepEqual(
    deriveClosedTestPipelineOutcome({
      ingress: { status: "PROCESSED" },
      outbound: { deliveryStatus: "DELIVERED" },
    }),
    { pipelineTerminal: true, pipelineOutcome: "delivered" },
  );

  const safe = projectSafeSyntheticResult({
    schema: "synthetic.outbound.v1",
    synthetic_token: "SYNTHETIC_OK",
    api_key: "leak",
  });
  assert.ok(safe);
  assert.equal(safe.syntheticToken, "SYNTHETIC_OK");
  assert.equal((safe as { api_key?: string }).api_key, undefined);

  const invalid = validateClosedTestCreateInput({
    sessionId: "bad id",
    requestId: "req",
    text: "hi",
  });
  assert.equal(invalid.ok, false);
}

async function assertUpstreamErrorBodiesSafe(): Promise<void> {
  const { readClosedTestUpstreamConfig } = await import(
    "../src/lib/bot-core/closed-test-config"
  );
  const { postClosedTestEventUpstream } = await import(
    "../src/lib/bot-core/closed-test-client"
  );
  const config = withEnv(
    { BOT_CORE_INTERNAL_URL: BASE, BOT_CLOSED_TEST_TOKEN: TOKEN },
    () => readClosedTestUpstreamConfig(),
  );

  for (const status of [409, 404, 422, 503] as const) {
    const result = await postClosedTestEventUpstream(
      config,
      { sessionId: "session_1", requestId: `req_${status}`, text: "x" },
      async () =>
        new Response(
          JSON.stringify({
            detail:
              status === 409
                ? "IDEMPOTENCY_CONFLICT"
                : status === 404
                  ? "NOT_FOUND"
                  : status === 422
                    ? "VALIDATION_ERROR"
                    : "INGRESS_UNAVAILABLE",
            token: TOKEN,
            input: "echo",
          }),
          { status },
        ),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      const serialized = JSON.stringify(result);
      assert.doesNotMatch(serialized, new RegExp(TOKEN));
      assert.doesNotMatch(serialized, /"input"/);
      assert.ok(result.status === status || (status === 401 && result.status === 503));
    }
  }
}

function assertNoModeEnumExpansion(): void {
  const defaults = read("src/lib/bot-settings/defaults.ts");
  assert.match(defaults, /export type BotMode = "OFF" \| "TEST" \| "HINTS" \| "DRAFT" \| "AUTO"/);
  assert.doesNotMatch(defaults, /CLOSED_TEST|SYNTHETIC_TEST/);
}

async function assertRedirectDoesNotFollowWithToken(): Promise<void> {
  const { readClosedTestUpstreamConfig } = await import(
    "../src/lib/bot-core/closed-test-config"
  );
  const { postClosedTestEventUpstream, getClosedTestEventUpstream } =
    await import("../src/lib/bot-core/closed-test-client");

  const config = withEnv(
    { BOT_CORE_INTERNAL_URL: BASE, BOT_CLOSED_TEST_TOKEN: TOKEN },
    () => readClosedTestUpstreamConfig(),
  );

  const evil = "https://evil.example/steal";
  const expectedPost = `${BASE}/internal/closed-test/events`;
  const expectedGet = `${expectedPost}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
  const calls: Array<{ url: string; redirect?: RequestRedirect; hasToken: boolean }> =
    [];

  const redirectingFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      redirect: init?.redirect,
      hasToken: headers.get("X-Bot-Closed-Test-Token") === TOKEN,
    });
    assert.equal(init?.redirect, "error");
    return new Response(null, {
      status: 302,
      headers: {
        Location: evil,
        "X-Echo-Token": TOKEN,
      },
    });
  };

  const post = await postClosedTestEventUpstream(
    config,
    { sessionId: "session_1", requestId: "req_redirect", text: "x" },
    redirectingFetch,
  );
  assert.equal(post.ok, false);
  if (!post.ok) {
    assert.equal(post.status, 502);
    assert.equal(post.code, "UPSTREAM_ERROR");
    const serialized = JSON.stringify(post);
    assert.doesNotMatch(serialized, /evil\.example|Location|steal/i);
    assert.doesNotMatch(serialized, new RegExp(TOKEN));
  }

  const get = await getClosedTestEventUpstream(
    config,
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    redirectingFetch,
  );
  assert.equal(get.ok, false);
  if (!get.ok) {
    assert.equal(get.status, 502);
    const serialized = JSON.stringify(get);
    assert.doesNotMatch(serialized, /evil\.example|Location|steal/i);
    assert.doesNotMatch(serialized, new RegExp(TOKEN));
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, expectedPost);
  assert.equal(calls[1]?.url, expectedGet);
  assert.ok(calls.every((call) => call.url !== evil));
  assert.ok(calls.every((call) => call.redirect === "error"));
  assert.ok(calls.every((call) => call.hasToken));
}

async function main(): Promise<void> {
  assertSourceContracts();
  assertPollingRegressionGuard();
  assertComposeWiring();
  assertGate();
  assertNoModeEnumExpansion();
  assertUpstreamStatusMapping();
  await assertConfigFailClosed();
  await assertProxyTokenServerSideOnly();
  await assertUpstreamErrorBodiesSafe();
  await assertRedirectDoesNotFollowWithToken();
  console.log("security-bot-closed-test-01b-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
