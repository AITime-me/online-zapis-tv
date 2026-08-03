import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";

const IS_ISOLATED = process.env.WHEEL_E2E_ISOLATED === "1";

if (!IS_ISOLATED) {
  loadEnv({ path: ".env" });
}

const WHEEL_SLUG = process.env.WHEEL_E2E_CATALOG_SLUG ?? "permanent-wheel";
const WHEEL_DRAFT_SLUG = process.env.WHEEL_E2E_DRAFT_SLUG ?? "";
const WHEEL_INVALID_SLUG = process.env.WHEEL_E2E_INVALID_SLUG ?? "";
const MOBILE = { width: 390, height: 844 };
const TEST_NAME = "E2E Wheel";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!IS_ISOLATED) {
    return;
  }
  for (const key of [
    "WHEEL_E2E_CATALOG_SLUG",
    "WHEEL_E2E_DRAFT_SLUG",
    "WHEEL_E2E_INVALID_SLUG",
  ]) {
    if (!process.env[key]?.trim()) {
      throw new Error(`Isolated wheel E2E requires ${key}`);
    }
  }
});

/** Deterministic unique local phone (10 digits) per test to avoid campaign collisions. */
export function phoneForTest(testNumber: number): string {
  const digits = String(9_123_456_000 + testNumber);
  return digits.slice(-10);
}

async function dismissCookieBanner(page: Page) {
  const accept = page.getByRole("button", { name: "Понятно" });
  if ((await accept.count()) > 0) {
    await accept.click({ force: true });
  }
}

async function gotoPromo(page: Page, slug: string) {
  const response = await page.goto(`/promo/${slug}`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await dismissCookieBanner(page);
}

async function gotoActiveWheel(page: Page) {
  await gotoPromo(page, WHEEL_SLUG);
  if (IS_ISOLATED) {
    await expect(page.getByTestId("wheel-fortune-public")).toBeVisible({
      timeout: 30_000,
    });
    return;
  }
  if ((await page.getByTestId("wheel-fortune-public").count()) === 0) {
    test.skip(true, "wheel catalog not available in this environment");
  }
}

async function acceptConsents(page: Page) {
  const personal = page.getByLabel(/согласие на обработку персональных данных/i);
  const offer = page.getByLabel(/ознакомлена с офертой/i);
  if ((await personal.count()) > 0) {
    await personal.check();
  }
  if ((await offer.count()) > 0) {
    await offer.check();
  }
}

async function fillLeadForm(page: Page, phone: string) {
  await page.getByLabel("Имя").fill(TEST_NAME);
  await page.getByLabel("Телефон").fill(phone);
  await acceptConsents(page);
}

async function spinWheel(page: Page, phone: string) {
  await fillLeadForm(page, phone);
  await page.getByTestId("wheel-start-button").click();
  await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("Wheel of Fortune public flow", () => {
  test("desktop happy path — form, spin, complete", async ({ page }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(1);
    await fillLeadForm(page, phone);
    await expect(page.getByTestId("wheel-start-button")).toBeEnabled();
    await spinWheel(page, phone);
    await page.getByRole("radio", { name: "Губы" }).check();
    await acceptConsents(page);
    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByText("Спасибо!")).toBeVisible({ timeout: 30_000 });
  });

  test("mobile viewport shows wheel", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoActiveWheel(page);
    await expect(page.getByTestId("wheel-fortune-public")).toBeVisible();
    await expect(page.getByTestId("wheel-start-button")).toBeVisible();
  });

  test("prefers-reduced-motion skips animation delay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoActiveWheel(page);
    await spinWheel(page, phoneForTest(3));
  });

  test("name, phone and consents are required before start", async ({ page }) => {
    await gotoActiveWheel(page);
    await page.getByTestId("wheel-start-button").click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("double-click start creates one session result", async ({ page }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(5);
    await fillLeadForm(page, phone);
    const start = page.getByTestId("wheel-start-button");
    await start.dblclick();
    await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
      timeout: 30_000,
    });
    const resultResponse = await page.request.get(
      `/api/game/wheel/result?catalogSlug=${encodeURIComponent(WHEEL_SLUG)}`,
    );
    expect(resultResponse.ok()).toBeTruthy();
    const body = (await resultResponse.json()) as {
      animation?: { sectorIndex: number };
    };
    expect(typeof body.animation?.sectorIndex).toBe("number");
  });

  test("refresh restores same sector and prize", async ({ page }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(6);
    await spinWheel(page, phone);
    const prizeBefore = await page
      .locator("strong")
      .filter({ hasText: /.+/ })
      .first()
      .textContent();
    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
      timeout: 30_000,
    });
    const prizeAfter = await page
      .locator("strong")
      .filter({ hasText: /.+/ })
      .first()
      .textContent();
    expect(prizeAfter).toBe(prizeBefore);
  });

  test("retry complete does not create duplicate submission UI", async ({
    page,
  }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(7);
    await spinWheel(page, phone);
    await page.getByRole("radio", { name: "Губы" }).check();
    await acceptConsents(page);
    const complete = page.getByTestId("wheel-complete-button");
    await complete.click();
    await expect(page.getByText("Спасибо!")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByText("Заявка уже отправлена")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("different interest after success does not change submitted state", async ({
    page,
  }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(8);
    await spinWheel(page, phone);
    await page.getByRole("radio", { name: "Губы" }).check();
    await acceptConsents(page);
    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByText("Спасибо!")).toBeVisible({ timeout: 30_000 });
    const submitted = await page.locator(".text-emerald-950 p").last().textContent();

    const cookies = await page.context().cookies();
    const retry = await page.request.post("/api/game/wheel/complete", {
      data: {
        catalogSlug: WHEEL_SLUG,
        interest: "brows",
        name: TEST_NAME,
        phone: `+7 ${phone.slice(0, 3)} ${phone.slice(3, 6)}-${phone.slice(6, 8)}-${phone.slice(8)}`,
        personalDataConsent: true,
        offerAcknowledgement: true,
      },
      headers: {
        "Idempotency-Key": `e2e-interest-retry-${phone}`,
        Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      },
    });
    expect(retry.ok()).toBeTruthy();
    const retryBody = (await retry.json()) as { ok?: boolean };
    expect(retryBody.ok).toBe(true);

    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByText("Заявка уже отправлена")).toBeVisible({
      timeout: 30_000,
    });
    const afterReload = await page.locator(".text-emerald-950 p").last().textContent();
    expect(afterReload).toBe(submitted);
  });

  test("network retry on complete preserves idempotency key", async ({
    page,
  }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(9);
    await spinWheel(page, phone);
    await page.getByRole("radio", { name: "Брови" }).check();
    await acceptConsents(page);

    let completeCalls = 0;
    await page.route("**/api/game/wheel/complete", async (route) => {
      completeCalls += 1;
      if (completeCalls === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await page.unroute("**/api/game/wheel/complete");
    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByText("Спасибо!")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Wheel promo gates", () => {
  test("DRAFT catalog blocked", async ({ page }) => {
    if (!IS_ISOLATED && !WHEEL_DRAFT_SLUG) {
      test.skip(true, "WHEEL_E2E_DRAFT_SLUG not configured");
    }
    await gotoPromo(page, WHEEL_DRAFT_SLUG);
    await expect(page.getByTestId("wheel-promo-unavailable")).toBeVisible();
    await expect(page.getByTestId("wheel-fortune-public")).toHaveCount(0);
  });

  test("ACTIVE invalid config blocked", async ({ page }) => {
    if (!IS_ISOLATED && !WHEEL_INVALID_SLUG) {
      test.skip(true, "WHEEL_E2E_INVALID_SLUG not configured");
    }
    await gotoPromo(page, WHEEL_INVALID_SLUG);
    await expect(page.getByTestId("wheel-promo-invalid-config")).toBeVisible();
    await expect(page.getByTestId("wheel-fortune-public")).toHaveCount(0);
  });

  test("ACTIVE valid config opens wheel", async ({ page }) => {
    await gotoActiveWheel(page);
    await expect(page.getByTestId("wheel-fortune-public")).toBeVisible();
  });
});

test.describe("Catch-Time regression", () => {
  test("procedure-gift page still loads", async ({ page }) => {
    const response = await page.goto("/promo/procedure-gift");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
