import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/amocrm/read-only-client.ts"),
  "utf8",
);
assert.match(source, /import "server-only"/);
assert.match(source, /const ALLOWED_RESOURCES/);
assert.match(source, /method: "GET"/);
assert.match(source, /method: "POST"/); // OAuth refresh only
assert.match(source, /"\/oauth2\/access_token"/);
for (const forbidden of [
  'method: "PATCH"',
  'method: "PUT"',
  'method: "DELETE"',
  ".create(",
  ".update(",
  ".delete(",
  "console.log",
]) {
  assert.equal(
    source.includes(forbidden),
    false,
    `forbidden operation: ${forbidden}`,
  );
}
assert.match(source, /replacementRefreshToken/);
assert.match(source, /never in Git or a browser/);
console.log("amoCRM read-only connector check: OK");
