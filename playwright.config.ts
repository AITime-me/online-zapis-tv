import { defineConfig } from "@playwright/test";

const isolated = process.env.WHEEL_E2E_ISOLATED === "1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

if (isolated) {
  if (!process.env.PLAYWRIGHT_BASE_URL?.trim()) {
    throw new Error(
      "WHEEL_E2E_ISOLATED=1 requires PLAYWRIGHT_BASE_URL (isolated random port)",
    );
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
    throw new Error(
      `WHEEL_E2E_ISOLATED=1 refuses baseURL ${baseURL}; expected http://127.0.0.1:<port>`,
    );
  }
  if (/localhost:3000/i.test(baseURL)) {
    throw new Error(
      "WHEEL_E2E_ISOLATED=1 refuses default localhost:3000 PLAYWRIGHT_BASE_URL",
    );
  }
}

const jsonReport = process.env.WHEEL_E2E_JSON_REPORT?.trim();

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  reporter: jsonReport
    ? [["list"], ["json", { outputFile: jsonReport }]]
    : [["list"]],
});
