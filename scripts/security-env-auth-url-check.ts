import assert from "node:assert/strict";
import {
  isLoopbackHostname,
  validateAuthUrlForRuntime,
} from "../src/lib/auth-url-policy";

function expectOk(authUrl: string, appEnv: "development" | "staging" | "production" | undefined): void {
  const result = validateAuthUrlForRuntime(authUrl, appEnv);
  assert.equal(
    result.ok,
    true,
    `Ожидалось, что AUTH_URL=${authUrl} (APP_ENV=${appEnv ?? "unset"}) допустим, но: ${
      result.ok ? "" : result.message
    }`,
  );
}

function expectError(authUrl: string, appEnv: "development" | "staging" | "production" | undefined): void {
  const result = validateAuthUrlForRuntime(authUrl, appEnv);
  assert.equal(
    result.ok,
    false,
    `Ожидалась ошибка для AUTH_URL=${authUrl} (APP_ENV=${appEnv ?? "unset"}), но проверка прошла`,
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

// 4. Loopback-HTTP запрещён вне staging
expectError("http://127.0.0.1:3000", "development");
expectError("http://localhost:3000", "production");

// 5. Невалидный URL и посторонние протоколы
expectError("not-a-url", "staging");
expectError("ftp://127.0.0.1", "staging");
expectError("ws://127.0.0.1:3000", "staging");

// 6. Хелпер loopback-хоста
assert.equal(isLoopbackHostname("127.0.0.1"), true);
assert.equal(isLoopbackHostname("localhost"), true);
assert.equal(isLoopbackHostname("[::1]"), true);
assert.equal(isLoopbackHostname("::1"), true);
assert.equal(isLoopbackHostname("example.ru"), false);
assert.equal(isLoopbackHostname("127.0.0.1.evil.com"), false);

console.log("security-env-auth-url-check: OK");
