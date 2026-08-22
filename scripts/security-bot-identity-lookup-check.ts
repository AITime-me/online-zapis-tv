import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import { assertBotInternalRouteCoverage } from "./security-bot-internal-route-coverage-check";

process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

async function main(): Promise<void> {
  const routePath = "src/app/api/internal/bot/v1/identity/lookup/route.ts";
  const servicePath = "src/services/BotIdentityLookupService.ts";
  const route = read(routePath);
  const service = read(servicePath);

  // Namespace-wide AST coverage proves the exact approved S2S wrapper is used.
  assert.ok(assertBotInternalRouteCoverage().includes(routePath));
  assert.match(route, /readBoundedJsonBody\(request, BOT_INTERNAL_MAX_JSON_BODY_BYTES\)/);
  assert.match(route, /Object\.keys\(body\.value\)\.length !== 1/);
  assert.match(route, /typeof \(body\.value as \{ phone\?: unknown \}\)\.phone !== "string"/);
  assert.match(route, /phone\.length > 32/);
  assert.match(route, /NextResponse\.json\(\{ ok: true as const, \.\.\.result \}\)/);
  assert.doesNotMatch(route, /name|email|normalizedPhone/);

  // Read only a client UUID and stop at two rows: enough to classify the
  // result without disclosing client attributes.
  assert.match(service, /select: \{ id: true \}/);
  assert.match(service, /take: 2/);
  assert.match(service, /isArchived: false/);
  assert.match(service, /mergedIntoClientId: null/);

  const { classifyBotIdentityLookupRows } = await import(
    "../src/services/BotIdentityLookupService"
  );
  assert.deepEqual(classifyBotIdentityLookupRows([]), { outcome: "NONE" });
  assert.deepEqual(classifyBotIdentityLookupRows([{ id: "client-1" }]), {
    outcome: "UNIQUE",
    clientId: "client-1",
  });
  assert.deepEqual(
    classifyBotIdentityLookupRows([{ id: "client-1" }, { id: "client-2" }]),
    { outcome: "AMBIGUOUS" },
  );

  console.log("security-bot-identity-lookup-check: OK");
}

void main();
