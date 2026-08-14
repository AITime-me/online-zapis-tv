import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const route = (name: string) =>
  readFileSync(
    resolve(root, `src/app/api/internal/neo-analytics/v1/${name}/route.ts`),
    "utf8",
  );

const appointments = route("appointments");
const masters = route("masters");
const services = route("services");
const combined = `${appointments}\n${masters}\n${services}`;

for (const forbidden of [
  "clientName",
  "clientPhone",
  "comment:",
  "importantNote",
  "clientId",
  "manageToken",
  "manageTokenHash",
  ".create(",
  ".update(",
  ".delete(",
  ".upsert(",
]) {
  assert.equal(combined.includes(forbidden), false, `forbidden token: ${forbidden}`);
}
assert.match(appointments, /MAX_RANGE_MS = 31/);
assert.match(appointments, /MAX_ROWS = 5000/);
assert.match(combined, /withNeoAnalyticsAuth/);
assert.equal(combined.includes("export const POST"), false);

const auth = readFileSync(resolve(root, "src/lib/neo-analytics/auth.ts"), "utf8");
assert.match(auth, /NEO_ANALYTICS_API_TOKEN/);
assert.match(auth, /token === botToken/);
assert.match(auth, /timingSafeEqual/);
assert.match(auth, /MAX_REQUESTS = 30/);

console.log("Neo analytics security check: OK");
