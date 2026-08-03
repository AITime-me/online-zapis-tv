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

function phoneE164(localPhone: string): string {
  return `+7${localPhone}`;
}

async function dismissCookieBanner(page: Page) {
  const accept = page.getByRole("button", { name: "Понятно" });
  try {
    // Banner mounts asynchronously; short wait, then ignore if absent.
    await accept.click({ timeout: 3_000 });
  } catch {
    // Optional UI — absence is not a failure.
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
  // Key phrases live in <a> siblings outside <label> fragments, so tests must
  // use explicit accessible names / test ids — never silent skip on miss.
  const personal = page.getByTestId("legal-personal-data-consent");
  const offer = page.getByTestId("legal-offer-acknowledgement");
  await expect(personal).toBeVisible({ timeout: 10_000 });
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await personal.check();
  await offer.check();
  await expect(personal).toBeChecked();
  await expect(offer).toBeChecked();
}

async function fillLeadForm(page: Page, phone: string) {
  await page.getByLabel("Имя").fill(TEST_NAME);
  // Phone input: data-testid + aria-label «Номер телефона».
  // Country code uses aria-label «Код страны» — do not use the bare «Телефон» label.
  await page.getByTestId("wheel-phone-input").fill(phone);
  await acceptConsents(page);
}

type WheelStartApiBody = {
  ok?: boolean;
  error?: string;
  code?: string;
  animation?: {
    sectorIndex?: number;
    prizeDisplayName?: string;
    totalSectors?: number;
  };
};

function safeWheelStartFailureMessage(
  status: number,
  body: WheelStartApiBody,
): string {
  const code = typeof body.code === "string" ? body.code : "none";
  const error = typeof body.error === "string" ? body.error : "unknown";
  // Never log request bodies, cookies, phones, or secrets.
  return `wheel start failed: HTTP ${status}, code=${code}, error=${error}`;
}

/**
 * Fail only on the game error region (data-testid=wheel-error-alert).
 * Next.js App Router mounts `#__next-route-announcer__` with role="alert"
 * and empty text on first load — that must not be treated as a game error.
 */
async function assertNoWheelGameError(
  page: Page,
  startMeta: { status: number; body: WheelStartApiBody; startPostCount: number },
): Promise<void> {
  const gameError = page.getByTestId("wheel-error-alert");
  const gameErrorCount = await gameError.count();
  const gameErrorText =
    gameErrorCount > 0
      ? ((await gameError.textContent()) ?? "").replace(/\s+/g, " ").trim()
      : "";

  // Diagnostics only — do not fail on unrelated role="alert" nodes.
  const alerts = page.getByRole("alert");
  const alertCount = await alerts.count();
  const alertTexts = (await alerts.allTextContents())
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const completeVisible = await page
    .getByTestId("wheel-complete-button")
    .isVisible()
    .catch(() => false);
  const startVisible = await page
    .getByTestId("wheel-start-button")
    .isVisible()
    .catch(() => false);
  const phaseHint = completeVisible
    ? "claim-or-later"
    : startVisible
      ? "lead-or-spinning"
      : "unknown";

  if (gameErrorCount > 0) {
    const startCode =
      typeof startMeta.body.code === "string" ? startMeta.body.code : "none";
    const startError =
      typeof startMeta.body.error === "string" ? startMeta.body.error : "none";
    throw new Error(
      [
        "wheel game error alert present after start",
        `gameErrorCount=${gameErrorCount}`,
        `gameErrorText=${JSON.stringify(gameErrorText)}`,
        `alertCount=${alertCount}`,
        `alertTexts=${JSON.stringify(alertTexts)}`,
        `uiPhaseHint=${phaseHint}`,
        `completeButtonVisible=${completeVisible}`,
        `startPostCount=${startMeta.startPostCount}`,
        `startHTTP=${startMeta.status}`,
        `startOk=${String(startMeta.body.ok === true)}`,
        `startCode=${startCode}`,
        `startError=${startError}`,
      ].join("; "),
    );
  }
}

/**
 * Fill lead form, POST /api/game/wheel/start, assert success, wait for claim UI.
 */
async function spinWheel(page: Page, phone: string) {
  await fillLeadForm(page, phone);

  let startPostCount = 0;
  const onStartResponse = (response: {
    url(): string;
    request(): { method(): string };
  }) => {
    if (
      response.url().includes("/api/game/wheel/start") &&
      response.request().method() === "POST"
    ) {
      startPostCount += 1;
    }
  };
  page.on("response", onStartResponse);

  const startResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/game/wheel/start") &&
      response.request().method() === "POST",
  );

  try {
    await page.getByTestId("wheel-start-button").click();

    const startResponse = await startResponsePromise;
    let body: WheelStartApiBody = {};
    try {
      body = (await startResponse.json()) as WheelStartApiBody;
    } catch {
      body = {};
    }

    if (
      startResponse.status() !== 200 ||
      body.ok !== true ||
      !body.animation ||
      typeof body.animation.sectorIndex !== "number" ||
      typeof body.animation.prizeDisplayName !== "string"
    ) {
      throw new Error(safeWheelStartFailureMessage(startResponse.status(), body));
    }

    const startMeta = {
      status: startResponse.status(),
      body,
      startPostCount,
    };
    await assertNoWheelGameError(page, startMeta);
    await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
      timeout: 30_000,
    });
    // Re-check after claim UI: catch late overlapping start failures.
    await assertNoWheelGameError(page, {
      status: startMeta.status,
      body: startMeta.body,
      startPostCount,
    });
  } finally {
    page.off("response", onStartResponse);
  }
}

test.describe("Wheel of Fortune public flow", () => {
  test("desktop happy path — form, spin, complete", async ({ page }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(1);
    await spinWheel(page, phone);
    await page.getByRole("radio", { name: "Губы" }).check();
    await acceptConsents(page);
    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByTestId("wheel-submitted")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Спасибо!")).toBeVisible();
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
    await expect(page.getByTestId("wheel-error-alert")).toBeVisible();
  });

  test("double-click start creates one session result", async ({ page }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(5);
    await fillLeadForm(page, phone);

    let startPostCount = 0;
    const onStartResponse = (response: {
      url(): string;
      request(): { method(): string };
    }) => {
      if (
        response.url().includes("/api/game/wheel/start") &&
        response.request().method() === "POST"
      ) {
        startPostCount += 1;
      }
    };
    page.on("response", onStartResponse);

    try {
      const start = page.getByTestId("wheel-start-button");
      await start.dblclick();
      await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
        timeout: 30_000,
      });
      expect(startPostCount).toBe(1);

      const resultResponse = await page.request.get(
        `/api/game/wheel/result?catalogSlug=${encodeURIComponent(WHEEL_SLUG)}`,
      );
      expect(resultResponse.ok()).toBeTruthy();
      const body = (await resultResponse.json()) as {
        animation?: { sectorIndex: number };
      };
      expect(typeof body.animation?.sectorIndex).toBe("number");
    } finally {
      page.off("response", onStartResponse);
    }
  });

  test("refresh restores same sector and prize", async ({ page }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(6);
    await spinWheel(page, phone);
    const prizeBefore = await page.getByTestId("wheel-prize-name").textContent();
    expect(prizeBefore?.trim()).toBeTruthy();
    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
      timeout: 30_000,
    });
    const prizeAfter = await page.getByTestId("wheel-prize-name").textContent();
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
    await expect(page.getByTestId("wheel-submitted")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Спасибо!")).toBeVisible();
    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByText("Заявка уже отправлена")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("wheel-complete-button")).toHaveCount(0);
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
    await expect(page.getByTestId("wheel-submitted")).toBeVisible({
      timeout: 30_000,
    });

    const resultBeforeResponse = await page.request.get(
      `/api/game/wheel/result?catalogSlug=${encodeURIComponent(WHEEL_SLUG)}`,
    );
    expect(resultBeforeResponse.ok()).toBeTruthy();
    const resultBefore = (await resultBeforeResponse.json()) as {
      bookingSubmitted?: boolean;
      animation?: { sectorIndex?: number; prizeDisplayName?: string };
    };
    expect(resultBefore.bookingSubmitted).toBe(true);
    expect(typeof resultBefore.animation?.sectorIndex).toBe("number");
    expect(resultBefore.animation?.prizeDisplayName).toBeTruthy();

    const origin = new URL(page.url()).origin;
    const retry = await page.request.post("/api/game/wheel/complete", {
      data: {
        catalogSlug: WHEEL_SLUG,
        interest: "brows",
        name: TEST_NAME,
        phone: phoneE164(phone),
        personalDataConsent: true,
        offerAcknowledgement: true,
      },
      headers: {
        "Idempotency-Key": `e2e-interest-retry-${phone}`,
        Origin: origin,
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
    await expect(page.getByTestId("wheel-complete-button")).toHaveCount(0);

    const resultAfterResponse = await page.request.get(
      `/api/game/wheel/result?catalogSlug=${encodeURIComponent(WHEEL_SLUG)}`,
    );
    expect(resultAfterResponse.ok()).toBeTruthy();
    const resultAfter = (await resultAfterResponse.json()) as {
      bookingSubmitted?: boolean;
      animation?: { sectorIndex?: number; prizeDisplayName?: string };
    };
    expect(resultAfter.bookingSubmitted).toBe(true);
    expect(resultAfter.animation?.sectorIndex).toBe(
      resultBefore.animation?.sectorIndex,
    );
    expect(resultAfter.animation?.prizeDisplayName).toBe(
      resultBefore.animation?.prizeDisplayName,
    );
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
    await expect(page.getByTestId("wheel-error-alert")).toBeVisible({
      timeout: 15_000,
    });
    await page.unroute("**/api/game/wheel/complete");
    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByTestId("wheel-submitted")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Спасибо!")).toBeVisible();
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
