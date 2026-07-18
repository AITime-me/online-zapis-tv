/**
 * Runtime smoke: assert final HTTP headers + Set-Cookie for manage-link
 * after `npm run build` + `next start`.
 *
 * Source grep is NOT enough — this hits a live server.
 *
 * Usage:
 *   npm run build
 *   npm run test:security:manage-link-headers-smoke
 *
 * Optional:
 *   MANAGE_SMOKE_BASE_URL=http://127.0.0.1:3000
 *   MANAGE_SMOKE_PORT=3457
 *
 * Staging:
 *   MANAGE_SMOKE_BASE_URL=https://staging.example npm run test:security:manage-link-headers-smoke
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createManageToken } from "../src/lib/booking/manage-token";
import {
  MANAGE_SESSION_COOKIE,
  MANAGE_SESSION_COOKIE_MAX_AGE_SEC,
} from "../src/lib/booking/manage-session-cookie";

const ROOT = process.cwd();
const EXTERNAL_BASE = process.env.MANAGE_SMOKE_BASE_URL?.trim() || "";
const PORT = Number(process.env.MANAGE_SMOKE_PORT || "3457");
const MALFORMED_TOKEN = "invalid-test-token";
const OVERLONG_TOKEN = `${"a".repeat(80)}_overlong`;

type HeaderMap = Record<string, string>;

function normalizeHeaders(headers: Headers): HeaderMap {
  const out: HeaderMap = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Node fetch may expose multiple Set-Cookie via getSetCookie(). */
function collectSetCookie(headers: Headers): string[] {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function assertNoStoreHeaders(headers: HeaderMap, label: string): void {
  const cache = headers["cache-control"] ?? "";
  assert.ok(cache, `${label}: missing Cache-Control`);
  assert.match(cache, /no-store/i, `${label}: Cache-Control must include no-store (got ${cache})`);
  assert.doesNotMatch(
    cache,
    /s-maxage/i,
    `${label}: Cache-Control must not include s-maxage (got ${cache})`,
  );
  assert.equal(
    headers["referrer-policy"],
    "no-referrer",
    `${label}: Referrer-Policy must be no-referrer (got ${headers["referrer-policy"]})`,
  );
}

function assertNotPrerenderCached(headers: HeaderMap, label: string): void {
  const cacheHit = headers["x-nextjs-cache"];
  if (cacheHit) {
    assert.notEqual(
      cacheHit.toUpperCase(),
      "HIT",
      `${label}: x-nextjs-cache must not be HIT (got ${cacheHit})`,
    );
  }
  const prerender = headers["x-nextjs-prerender"];
  if (prerender !== undefined) {
    assert.notEqual(
      prerender,
      "1",
      `${label}: must not be prerendered (x-nextjs-prerender=${prerender})`,
    );
  }
}

function assertManageSetCookie(
  setCookieLines: string[],
  opts: { secureExpected: boolean; token: string },
): string {
  const line =
    setCookieLines.find((entry) => entry.startsWith(`${MANAGE_SESSION_COOKIE}=`)) ??
    "";
  assert.ok(line, `missing Set-Cookie ${MANAGE_SESSION_COOKIE}`);
  assert.match(line, new RegExp(`${MANAGE_SESSION_COOKIE}=`));
  assert.ok(
    line.includes(opts.token) || line.includes(encodeURIComponent(opts.token)),
    "Set-Cookie must contain the bearer token value",
  );
  assert.match(line, /HttpOnly/i);
  assert.match(line, /SameSite=Strict/i);
  assert.match(line, /Path=\//i);
  assert.match(
    line,
    new RegExp(`Max-Age=${MANAGE_SESSION_COOKIE_MAX_AGE_SEC}\\b`, "i"),
  );
  assert.doesNotMatch(line, /Domain=/i);
  if (opts.secureExpected) {
    assert.match(line, /;\s*Secure/i);
  } else {
    assert.doesNotMatch(line, /;\s*Secure/i);
  }
  return line;
}

async function fetchHeaders(
  base: string,
  pathAndQuery: string,
  init?: RequestInit,
): Promise<{ status: number; headers: HeaderMap; body: string; setCookie: string[] }> {
  const response = await fetch(`${base}${pathAndQuery}`, init);
  const body = await response.text();
  return {
    status: response.status,
    headers: normalizeHeaders(response.headers),
    body,
    setCookie: collectSetCookie(response.headers),
  };
}

async function waitForServer(base: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${base}/booking/manage`, { method: "GET" });
      void res.body?.cancel?.();
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Server did not become ready at ${base}`);
}

async function runAssertions(base: string): Promise<void> {
  const plausibleToken = createManageToken();
  const secondToken = createManageToken();
  const secureExpected = base.startsWith("https://");

  // --- 303 + Set-Cookie for plausible token ---
  const redirectProbe = await fetch(
    `${base}/booking/manage?token=${encodeURIComponent(plausibleToken)}`,
    { redirect: "manual" },
  );
  assert.equal(redirectProbe.status, 303, `expected 303, got ${redirectProbe.status}`);
  const location = redirectProbe.headers.get("location") ?? "";
  assert.equal(
    new URL(location, base).pathname,
    "/booking/manage",
    `Location path must be /booking/manage (got ${location})`,
  );
  assert.doesNotMatch(location, /token=/i, `Location must not keep token: ${location}`);
  const redirectBody = await redirectProbe.text();
  assert.doesNotMatch(redirectBody, new RegExp(plausibleToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assertNoStoreHeaders(normalizeHeaders(redirectProbe.headers), "manage redirect");
  const setCookieLine = assertManageSetCookie(collectSetCookie(redirectProbe.headers), {
    secureExpected,
    token: plausibleToken,
  });

  // --- malformed / overlong must NOT set cookie ---
  for (const bad of [MALFORMED_TOKEN, OVERLONG_TOKEN]) {
    const badRedirect = await fetch(
      `${base}/booking/manage?token=${encodeURIComponent(bad)}`,
      { redirect: "manual" },
    );
    assert.equal(badRedirect.status, 303, `malformed token should still 303-strip query`);
    const badLocation = badRedirect.headers.get("location") ?? "";
    assert.doesNotMatch(badLocation, /token=/i);
    const badCookies = collectSetCookie(badRedirect.headers).join("\n");
    assert.doesNotMatch(
      badCookies,
      new RegExp(`${MANAGE_SESSION_COOKIE}=`),
      `malformed token must not Set-Cookie (${bad.slice(0, 24)}…)`,
    );
    assertNoStoreHeaders(normalizeHeaders(badRedirect.headers), "malformed redirect");
  }

  // --- second link replaces cookie ---
  const secondRedirect = await fetch(
    `${base}/booking/manage?token=${encodeURIComponent(secondToken)}`,
    { redirect: "manual" },
  );
  assert.equal(secondRedirect.status, 303);
  assertManageSetCookie(collectSetCookie(secondRedirect.headers), {
    secureExpected,
    token: secondToken,
  });

  // --- followed page: no token in body, no-store ---
  const page = await fetchHeaders(
    base,
    `/booking/manage?token=${encodeURIComponent(plausibleToken)}`,
  );
  assert.equal(page.status, 200, "manage page should return 200 with safe UI shell");
  assertNoStoreHeaders(page.headers, "manage page");
  assertNotPrerenderCached(page.headers, "manage page");
  assert.doesNotMatch(page.body, new RegExp(plausibleToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // --- API invalid token: unified 404 ---
  const apiGet = await fetchHeaders(
    base,
    `/api/booking/manage?token=${encodeURIComponent(plausibleToken)}`,
  );
  assertNoStoreHeaders(apiGet.headers, "manage GET API");
  assert.equal(
    apiGet.status,
    404,
    `invalid manage token must be unified 404 (got ${apiGet.status}: ${apiGet.body.slice(0, 200)})`,
  );
  assert.match(apiGet.body, /недействительна/i);
  assert.doesNotMatch(apiGet.body, new RegExp(plausibleToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // --- mutation without Origin: 403 ---
  const csrf = await fetchHeaders(base, "/api/booking/manage/cancel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
    },
    body: JSON.stringify({ token: plausibleToken }),
  });
  assert.equal(csrf.status, 403, "cross-origin manage cancel must be forbidden");
  assertNoStoreHeaders(csrf.headers, "manage cancel CSRF");

  // --- admin remains protected (not public via manage auth bypass) ---
  const adminResponse = await fetch(`${base}/admin`, { redirect: "manual" });
  assert.ok(
    adminResponse.status === 307 ||
      adminResponse.status === 302 ||
      adminResponse.status === 303 ||
      adminResponse.status === 401,
    `admin must not be publicly readable (got ${adminResponse.status})`,
  );
  const adminLocation = adminResponse.headers.get("location") ?? "";
  assert.match(adminLocation, /login/i, `admin should redirect to login (got ${adminLocation})`);
  console.log("manage redirect status:", redirectProbe.status);
  console.log("manage redirect Location:", location);
  console.log("manage Set-Cookie:", setCookieLine);
  console.log("manage Set-Cookie secureExpected:", secureExpected);
  console.log("manage page Cache-Control:", page.headers["cache-control"]);
  console.log("manage page Referrer-Policy:", page.headers["referrer-policy"]);
  console.log(
    "manage page x-nextjs-cache:",
    page.headers["x-nextjs-cache"] ?? "(absent)",
  );
  console.log(
    "manage page x-nextjs-prerender:",
    page.headers["x-nextjs-prerender"] ?? "(absent)",
  );
  console.log("manage GET Cache-Control:", apiGet.headers["cache-control"]);
  console.log("manage GET status:", apiGet.status);
  console.log("manage CSRF status:", csrf.status);
  console.log("admin status:", adminResponse.status, "location:", adminLocation);
}

async function spawnNextStart(): Promise<{
  base: string;
  child: ChildProcess;
}> {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  assert.ok(fs.existsSync(nextBin), "next binary missing — run npm install");
  assert.ok(
    fs.existsSync(path.join(ROOT, ".next")),
    "Missing .next — run npm run build before this smoke",
  );

  const base = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  try {
    await waitForServer(base);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      `Failed to start next start on ${base}: ${String(error)}\nstderr:\n${stderr}`,
    );
  }

  return { base, child };
}

async function main(): Promise<void> {
  let child: ChildProcess | null = null;
  let base = EXTERNAL_BASE;

  try {
    if (!base) {
      const spawned = await spawnNextStart();
      base = spawned.base;
      child = spawned.child;
    }

    await runAssertions(base.replace(/\/$/, ""));
    console.log(`manage-link headers smoke passed against ${base}`);
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await delay(300);
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
