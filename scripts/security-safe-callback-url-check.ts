process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SAFE_LOGIN_CALLBACK,
  isSafeInternalCallbackPath,
  resolveSafeInternalCallbackUrl,
} from "../src/lib/auth/safe-callback-url";

function assertSafePaths(): void {
  assert.equal(isSafeInternalCallbackPath("/schedule"), true);
  assert.equal(
    isSafeInternalCallbackPath("/admin/clients?tab=open"),
    true,
  );
  assert.equal(isSafeInternalCallbackPath("/"), true);

  assert.equal(isSafeInternalCallbackPath("https://evil.example"), false);
  assert.equal(isSafeInternalCallbackPath("//evil.example"), false);
  assert.equal(isSafeInternalCallbackPath("/\\evil.example"), false);
  assert.equal(isSafeInternalCallbackPath("\\\\evil.example"), false);
  assert.equal(isSafeInternalCallbackPath("javascript:alert(1)"), false);
  assert.equal(isSafeInternalCallbackPath("data:text/html,hi"), false);
  assert.equal(isSafeInternalCallbackPath("/%2f%2fevil.example"), false);
  assert.equal(isSafeInternalCallbackPath("/%5cevil"), false);
  assert.equal(isSafeInternalCallbackPath(""), false);
  assert.equal(isSafeInternalCallbackPath("   "), false);
  assert.equal(isSafeInternalCallbackPath("schedule"), false);
}

function assertResolverFallback(): void {
  assert.equal(
    resolveSafeInternalCallbackUrl(null),
    DEFAULT_SAFE_LOGIN_CALLBACK,
  );
  assert.equal(
    resolveSafeInternalCallbackUrl(""),
    DEFAULT_SAFE_LOGIN_CALLBACK,
  );
  assert.equal(
    resolveSafeInternalCallbackUrl("https://evil.example"),
    DEFAULT_SAFE_LOGIN_CALLBACK,
  );
  assert.equal(
    resolveSafeInternalCallbackUrl("//evil.example"),
    DEFAULT_SAFE_LOGIN_CALLBACK,
  );
  assert.equal(
    resolveSafeInternalCallbackUrl("/schedule"),
    "/schedule",
  );
  assert.equal(
    resolveSafeInternalCallbackUrl("/admin?x=1"),
    "/admin?x=1",
  );
}

function assertLoginUsesHelper(): void {
  const login = fs.readFileSync(
    path.join(process.cwd(), "src/app/(internal)/login/page.tsx"),
    "utf8",
  );
  assert.match(login, /resolveSafeInternalCallbackUrl/);
  assert.doesNotMatch(
    login,
    /searchParams\.get\("callbackUrl"\)\s*\?\?\s*"\/schedule"/,
  );
  assert.match(login, /router\.push\(callbackUrl\)/);
}

function run(): void {
  assertSafePaths();
  assertResolverFallback();
  assertLoginUsesHelper();
  console.log("security-safe-callback-url-check: OK");
}

run();
