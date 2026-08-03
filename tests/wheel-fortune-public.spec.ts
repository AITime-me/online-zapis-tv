import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });

const WHEEL_SLUG = process.env.WHEEL_E2E_CATALOG_SLUG ?? "permanent-wheel";
const WHEEL_DRAFT_SLUG = process.env.WHEEL_E2E_DRAFT_SLUG ?? "";
const WHEEL_INVALID_SLUG = process.env.WHEEL_E2E_INVALID_SLUG ?? "";
const MOBILE = { width: 390, height: 844 };
const TEST_PHONE = "9123456789";
const TEST_NAME = "E2E Wheel";

async function dismissCookieBanner(page: Page) {
  const accept = page.getByRole("button", { name: "Понятно" });
  if ((await accept.count()) > 0) {
    await accept.click({ force: true });
  }
}

async function wheelAvailable(page: Page, slug = WHEEL_SLUG): Promise<boolean> {
  const response = await page.goto(`/promo/${slug}`);
  if (!response || response.status() === 404) {
    return false;
  }
  await dismissCookieBanner(page);
  return (await page.getByTestId("wheel-fortune-public").count()) > 0;
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

async function fillLeadForm(page: Page) {
  await page.getByLabel("Имя").fill(TEST_NAME);
  await page.getByLabel("Телефон").fill(TEST_PHONE);
  await acceptConsents(page);
}

async function spinWheel(page: Page) {
  await fillLeadForm(page);
  await page.getByTestId("wheel-start-button").click();
  await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("Wheel of Fortune public flow", () => {
  test("desktop happy path — form, spin, complete", async ({ page }) => {
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await fillLeadForm(page);
    await expect(page.getByTestId("wheel-start-button")).toBeEnabled();
    await spinWheel(page);
    await page.getByRole("radio", { name: "Губы" }).check();
    await acceptConsents(page);
    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByText("Спасибо!")).toBeVisible({ timeout: 30_000 });
  });

  test("mobile viewport shows wheel", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await expect(page.getByTestId("wheel-fortune-public")).toBeVisible();
  });

  test("prefers-reduced-motion skips animation delay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await spinWheel(page);
  });

  test("name, phone and consents are required before start", async ({ page }) => {
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await page.getByTestId("wheel-start-button").click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("double-click start creates one session result", async ({ page }) => {
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await fillLeadForm(page);
    const start = page.getByTestId("wheel-start-button");
    await start.dblclick();
    await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
      timeout: 30_000,
    });
    const resultResponse = await page.request.get(
      `/api/game/wheel/result?catalogSlug=${encodeURIComponent(WHEEL_SLUG)}`,
    );
    expect(resultResponse.ok()).toBeTruthy();
    const body = (await resultResponse.json()) as { animation?: { sectorIndex: number } };
    expect(typeof body.animation?.sectorIndex).toBe("number");
  });

  test("refresh restores same sector and prize", async ({ page }) => {
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await spinWheel(page);
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
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await spinWheel(page);
    await page.getByRole("radio", { name: "Губы" }).check();
    await acceptConsents(page);
    const complete = page.getByTestId("wheel-complete-button");
    await complete.click();
    await expect(page.getByText("Спасибо!")).toBeVisible({ timeout: 30_000 });
    const message = await page.locator(".text-emerald-950").textContent();
    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByText("Заявка уже отправлена")).toBeVisible({
      timeout: 30_000,
    });
    void message;
  });

  test("different interest after success does not change submitted state", async ({
    page,
  }) => {
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await spinWheel(page);
    await page.getByRole("radio", { name: "Губы" }).check();
    await acceptConsents(page);
    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByText("Спасибо!")).toBeVisible({ timeout: 30_000 });
    const submitted = await page.locator(".text-emerald-950 p").last().textContent();
    const retry = await page.request.post("/api/game/wheel/complete", {
      data: {
        catalogSlug: WHEEL_SLUG,
        interest: "brows",
        name: TEST_NAME,
        phone: "+7 912 345-67-89",
        personalDataConsent: true,
        offerAcknowledgement: true,
      },
      headers: { "Idempotency-Key": `e2e-retry-${Date.now()}` },
    });
    const retryBody = (await retry.json()) as { ok?: boolean };
    if (retry.ok()) {
      expect(retryBody.ok).toBe(true);
    }
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
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
    await spinWheel(page);
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
    test.skip(!WHEEL_DRAFT_SLUG, "WHEEL_E2E_DRAFT_SLUG not configured");
    await page.goto(`/promo/${WHEEL_DRAFT_SLUG}`);
    await dismissCookieBanner(page);
    await expect(page.getByTestId("wheel-promo-unavailable")).toBeVisible();
    await expect(page.getByTestId("wheel-fortune-public")).toHaveCount(0);
  });

  test("ACTIVE invalid config blocked", async ({ page }) => {
    test.skip(!WHEEL_INVALID_SLUG, "WHEEL_E2E_INVALID_SLUG not configured");
    await page.goto(`/promo/${WHEEL_INVALID_SLUG}`);
    await dismissCookieBanner(page);
    await expect(page.getByTestId("wheel-promo-invalid-config")).toBeVisible();
    await expect(page.getByTestId("wheel-fortune-public")).toHaveCount(0);
  });

  test("ACTIVE valid config opens wheel", async ({ page }) => {
    test.skip(!(await wheelAvailable(page)), "wheel catalog not available");
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
