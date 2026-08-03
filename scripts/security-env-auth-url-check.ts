import assert from "node:assert/strict";
import {
  isLoopbackHostname,
  validateAuthUrlForRuntime,
  type AuthUrlValidationOptions,
} from "../src/lib/auth-url-policy";
import fs from "node:fs";
import path from "node:path";

function expectOk(
  authUrl: string,
  appEnv: "development" | "staging" | "production" | undefined,
  options?: AuthUrlValidationOptions,
): void {
  const result = validateAuthUrlForRuntime(authUrl, appEnv, options);
  assert.equal(
    result.ok,
    true,
    `Ожидалось, что AUTH_URL=${authUrl} (APP_ENV=${appEnv ?? "unset"}, isolated=${
      options?.allowIsolatedE2eLoopbackHttp ? "1" : "0"
    }) допустим, но: ${result.ok ? "" : result.message}`,
  );
}

function expectError(
  authUrl: string,
  appEnv: "development" | "staging" | "production" | undefined,
  options?: AuthUrlValidationOptions,
): void {
  const result = validateAuthUrlForRuntime(authUrl, appEnv, options);
  assert.equal(
    result.ok,
    false,
    `Ожидалась ошибка для AUTH_URL=${authUrl} (APP_ENV=${appEnv ?? "unset"}, isolated=${
      options?.allowIsolatedE2eLoopbackHttp ? "1" : "0"
    }), но проверка прошла`,
  );
}

// 1. Настоящий production: только https://
expectError("http://127.0.0.1:3000", "production");
expectError("http://127.0.0.1:3000", undefined);
expectOk("https://example.ru", "production");
expectOk("https://example.ru", undefined);

// 2. Staging: HTTP разрешён только для loopback
expectOk("http://127.0.0.1:3000", "staging");
expectOk("http://localhost:3000", "staging");
expectOk("http://[::1]:3000", "staging");
expectOk("https://staging.example.ru", "staging");

// 3. Staging: внешние HTTP-адреса запрещены
expectError("http://example.ru", "staging");
expectError("http://203.0.113.10:3000", "staging");
expectError("http://evil.localhost.attacker.com", "staging");

// 4. Loopback-HTTP запрещён вне staging (без isolated-флага)
expectError("http://127.0.0.1:3000", "development");
expectError("http://localhost:3000", "production");

// 5. Isolated wheel E2E: loopback HTTP разрешён только с явным флагом
expectOk("http://127.0.0.1:38123", "production", {
  allowIsolatedE2eLoopbackHttp: true,
});
expectOk("http://localhost:38123", undefined, {
  allowIsolatedE2eLoopbackHttp: true,
});
expectError("http://127.0.0.1:38123", "production");
expectError("http://example.ru", "production", {
  allowIsolatedE2eLoopbackHttp: true,
});
expectError("http://203.0.113.10:3000", "production", {
  allowIsolatedE2eLoopbackHttp: true,
});

// 6. Невалидный URL и посторонние протоколы
expectError("not-a-url", "staging");
expectError("ftp://127.0.0.1", "staging");
expectError("ws://127.0.0.1:3000", "staging");

// 7. Хелпер loopback-хоста
assert.equal(isLoopbackHostname("127.0.0.1"), true);
assert.equal(isLoopbackHostname("localhost"), true);
assert.equal(isLoopbackHostname("[::1]"), true);
assert.equal(isLoopbackHostname("::1"), true);
assert.equal(isLoopbackHostname("example.ru"), false);
assert.equal(isLoopbackHostname("127.0.0.1.evil.com"), false);

// 8. env.ts wires bypass only via WHEEL_E2E_ISOLATED === "1"
const envSource = fs.readFileSync(
  path.resolve(__dirname, "../src/lib/env.ts"),
  "utf8",
);
assert.match(
  envSource,
  /allowIsolatedE2eLoopbackHttp:\s*process\.env\.WHEEL_E2E_ISOLATED\s*===\s*["']1["']/,
  "production env validation must gate loopback HTTP on WHEEL_E2E_ISOLATED=1 only",
);
assert.doesNotMatch(
  envSource,
  /allowIsolatedE2eLoopbackHttp:\s*true/,
  "isolated AUTH_URL bypass must not be hard-coded true",
);

console.log("security-env-auth-url-check: OK");
