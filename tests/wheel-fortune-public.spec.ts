import { expect, test, type Page, type Response } from "@playwright/test";
import { config as loadEnv } from "dotenv";

const IS_ISOLATED = process.env.WHEEL_E2E_ISOLATED === "1";

if (!IS_ISOLATED) {
  loadEnv({ path: ".env" });
}

const WHEEL_SLUG = process.env.WHEEL_E2E_CATALOG_SLUG ?? "permanent-wheel";
const WHEEL_DRAFT_SLUG = process.env.WHEEL_E2E_DRAFT_SLUG ?? "";
const WHEEL_INVALID_SLUG = process.env.WHEEL_E2E_INVALID_SLUG ?? "";
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

function isWheelStartPost(response: Response): boolean {
  return (
    response.url().includes("/api/game/wheel/start") &&
    response.request().method() === "POST"
  );
}

function isWheelCompletePost(response: Response): boolean {
  return (
    response.url().includes("/api/game/wheel/complete") &&
    response.request().method() === "POST"
  );
}

function isWheelResultGet(response: Response): boolean {
  return (
    response.url().includes("/api/game/wheel/result") &&
    response.request().method() === "GET"
  );
}

type InPageFetchResult<T> = {
  status: number;
  ok: boolean;
  bodyText: string;
  body: T;
};

/** Relative wheel API paths only — never absolute or protocol-relative URLs. */
const WHEEL_IN_PAGE_API_PATH_RE =
  /^\/api\/game\/wheel\/(start|result|complete)(?:\?|$)/;

function assertAllowlistedWheelApiPath(path: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("wheel in-page fetch rejected: empty path");
  }
  // Fail closed before browser fetch: schemes, //host, traversal, backslashes.
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("..")
  ) {
    throw new Error("wheel in-page fetch rejected: non-relative or unsafe path");
  }
  if (!WHEEL_IN_PAGE_API_PATH_RE.test(path)) {
    throw new Error(
      "wheel in-page fetch rejected: path outside wheel API allowlist",
    );
  }
}

/**
 * Session-authenticated wheel API calls MUST use in-page fetch with
 * credentials:"include". Isolated runtime sets NODE_ENV=production, so session
 * cookies are Secure on http://127.0.0.1. Chromium sends them; Playwright's
 * Node-side page.request cookie jar often does not → 404/403 on /result.
 * Never use a detached APIRequestContext for wheel session reads/writes.
 * Paths must be relative allowlisted wheel routes (same-origin only).
 */
async function fetchJsonInPage<T extends Record<string, unknown>>(
  page: Page,
  path: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  },
): Promise<InPageFetchResult<T>> {
  assertAllowlistedWheelApiPath(path);

  const result = await page.evaluate(
    async ({ path, method, headers, body }) => {
      const response = await fetch(path, {
        method: method ?? "GET",
        credentials: "include",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(headers ?? {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const bodyText = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        bodyText: bodyText.slice(0, 800),
      };
    },
    {
      path,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    },
  );

  let body = {} as T;
  try {
    body = JSON.parse(result.bodyText) as T;
  } catch {
    body = {} as T;
  }
  return { ...result, body };
}

/** Cookie names only — never values, phones, or tokens. */
async function sessionCookiePresence(page: Page): Promise<{
  cookieNames: string[];
  hasVisitorCookie: boolean;
  hasSessionCookie: boolean;
}> {
  const cookies = await page.context().cookies();
  const cookieNames = [...new Set(cookies.map((cookie) => cookie.name))].sort();
  return {
    cookieNames,
    hasVisitorCookie: cookieNames.includes("game_visitor"),
    hasSessionCookie: cookieNames.some((name) => name.startsWith("gs_")),
  };
}

async function readUiPhaseHint(page: Page): Promise<string> {
  const submittedVisible = await page
    .getByTestId("wheel-submitted")
    .isVisible()
    .catch(() => false);
  const completeVisible = await page
    .getByTestId("wheel-complete-button")
    .isVisible()
    .catch(() => false);
  const spinVisible = await page
    .getByTestId("wheel-spin-button")
    .isVisible()
    .catch(() => false);
  const introVisible = await page
    .getByTestId("wheel-start-button")
    .isVisible()
    .catch(() => false);
  if (submittedVisible) {
    return "submitted";
  }
  if (completeVisible) {
    return "result-or-restored";
  }
  if (spinVisible) {
    return "ready-or-spinning";
  }
  if (introVisible) {
    return "intro";
  }
  return "unknown";
}

type WheelResultApiBody = {
  ok?: boolean;
  error?: string;
  code?: string;
  bookingSubmitted?: boolean;
  animation?: { sectorIndex?: number; prizeDisplayName?: string };
};

async function assertWheelResultInPage(
  page: Page,
  meta: {
    startPostCount: number;
    startHTTP: number;
    startOk: boolean;
  },
): Promise<WheelResultApiBody> {
  const path = `/api/game/wheel/result?catalogSlug=${encodeURIComponent(WHEEL_SLUG)}`;
  const result = await fetchJsonInPage<WheelResultApiBody>(page, path);

  if (!result.ok || result.body.ok !== true) {
    const cookies = await sessionCookiePresence(page);
    const phase = await readUiPhaseHint(page);
    const code =
      typeof result.body.code === "string" ? result.body.code : "none";
    const error =
      typeof result.body.error === "string" ? result.body.error : "none";
    throw new Error(
      [
        "wheel result request failed",
        `HTTP ${result.status}`,
        `code=${code}`,
        `error=${error}`,
        `body=${JSON.stringify(result.bodyText)}`,
        `startPostCount=${meta.startPostCount}`,
        `startHTTP=${meta.startHTTP}`,
        `startOk=${String(meta.startOk)}`,
        `hasVisitorCookie=${String(cookies.hasVisitorCookie)}`,
        `hasSessionCookie=${String(cookies.hasSessionCookie)}`,
        `cookieNames=${cookies.cookieNames.join(",")}`,
        `url=${page.url()}`,
        `uiPhaseHint=${phase}`,
        `claimVisible=${String(phase === "result-or-restored")}`,
      ].join("; "),
    );
  }

  return result.body;
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

async function choosePrimaryLipsPreferences(page: Page) {
  await page.getByRole("button", { name: /Первый перманент/i }).click();
  await page.getByRole("button", { name: /^Губы$/i }).click();
  await page.getByTestId("preferences-continue").click();
}

async function fillContactForm(page: Page, phone: string) {
  await page.getByLabel("Имя").fill(TEST_NAME);
  await page.getByTestId("wheel-phone-input").fill(phone);
  await acceptConsents(page);
}

/** Fresh flow through intro → preferences → contact → ready. */
async function reachReady(page: Page, phone: string) {
  await expect(page.getByTestId("wheel-start-button")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("wheel-start-button").click();
  await choosePrimaryLipsPreferences(page);
  await fillContactForm(page, phone);
  await page.getByTestId("contact-continue").click();
  await expect(page.getByTestId("wheel-spin-button")).toBeVisible({
    timeout: 15_000,
  });
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
  const spinVisible = await page
    .getByTestId("wheel-spin-button")
    .isVisible()
    .catch(() => false);
  const phaseHint = completeVisible
    ? "result-or-later"
    : spinVisible
      ? "ready-or-spinning"
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
 * Fresh path: preferences + contact, POST /start, wait for result claim UI.
 * Preferences are already mapped and held in React state — no post-spin form.
 */
async function spinWheel(page: Page, phone: string) {
  await reachReady(page, phone);

  let startPostCount = 0;
  const onStartResponse = (response: Response) => {
    if (isWheelStartPost(response)) {
      startPostCount += 1;
    }
  };
  page.on("response", onStartResponse);

  const startResponsePromise = page.waitForResponse(isWheelStartPost);

  try {
    await page.getByTestId("wheel-spin-button").click();

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

    // Guard: /start request must not include preferences.
    const startRequestText = startResponse.request().postData() ?? "";
    expect(startRequestText).not.toMatch(/"interest"/i);
    expect(startRequestText).not.toMatch(/"confirmedZone"/i);
    expect(startRequestText).not.toMatch(/"selectedIntent"/i);

    const startMeta = {
      status: startResponse.status(),
      body,
      startPostCount,
    };
    await assertNoWheelGameError(page, startMeta);
    await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
      timeout: 30_000,
    });
    // Fresh result: contact form must not reappear.
    await expect(page.getByTestId("wheel-phone-input")).toHaveCount(0);
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

    let completeBodyInterest: string | undefined;
    await page.route("**/api/game/wheel/complete", async (route) => {
      const raw = route.request().postData() ?? "{}";
      try {
        const parsed = JSON.parse(raw) as { interest?: string };
        completeBodyInterest = parsed.interest;
      } catch {
        completeBodyInterest = undefined;
      }
      await route.continue();
    });

    await spinWheel(page, phone);
    const completeResponsePromise = page.waitForResponse(isWheelCompletePost);
    await page.getByTestId("wheel-complete-button").click();
    const completeResponse = await completeResponsePromise;
    expect(completeResponse.ok()).toBeTruthy();
    expect(completeBodyInterest).toBe("lips");
    await expect(page.getByTestId("wheel-submitted")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Заявка отправлена" }),
    ).toBeVisible();
  });

  test("mobile viewport shows wheel", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await gotoActiveWheel(page);
    await expect(page.getByTestId("wheel-fortune-public")).toBeVisible();
    await expect(page.getByTestId("wheel-start-button")).toBeVisible();
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 1;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test("prefers-reduced-motion skips animation delay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoActiveWheel(page);
    await spinWheel(page, phoneForTest(3));
  });

  test("name, phone and consents are required before start", async ({
    page,
  }) => {
    await gotoActiveWheel(page);
    await page.getByTestId("wheel-start-button").click();
    await choosePrimaryLipsPreferences(page);

    const nameInput = page.getByLabel("Имя");
    const phoneInput = page.getByTestId("wheel-phone-input");
    const personal = page.getByTestId("legal-personal-data-consent");
    const offer = page.getByTestId("legal-offer-acknowledgement");
    const continueBtn = page.getByTestId("contact-continue");

    let startPostCount = 0;
    const onStartResponse = (response: Response) => {
      if (isWheelStartPost(response)) {
        startPostCount += 1;
      }
    };
    page.on("response", onStartResponse);

    try {
      await continueBtn.click();
      await expect(page.getByText("Введите имя")).toBeVisible();
      expect(startPostCount).toBe(0);
      await expect(page.getByTestId("wheel-spin-button")).toHaveCount(0);

      await nameInput.fill(TEST_NAME);
      await phoneInput.fill(phoneForTest(4));
      await expect(personal).not.toBeChecked();
      await expect(offer).not.toBeChecked();

      await continueBtn.click();
      await expect(page.getByText(/соглас/i).first()).toBeVisible({
        timeout: 5_000,
      });
      expect(startPostCount).toBe(0);
      await expect(page.getByTestId("wheel-spin-button")).toHaveCount(0);
    } finally {
      page.off("response", onStartResponse);
    }
  });

  test("double-click sends one start request and restores one readable result", async ({
    page,
  }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(5);
    await reachReady(page, phone);

    let startPostCount = 0;
    const onStartResponse = (response: Response) => {
      if (isWheelStartPost(response)) {
        startPostCount += 1;
      }
    };
    page.on("response", onStartResponse);

    const startResponsePromise = page.waitForResponse(isWheelStartPost);

    try {
      const start = page.getByTestId("wheel-spin-button");
      await expect(start).toBeEnabled();
      await start.dblclick();

      const startResponse = await startResponsePromise;
      const startHTTP = startResponse.status();
      let startBody: WheelStartApiBody = {};
      try {
        startBody = (await startResponse.json()) as WheelStartApiBody;
      } catch {
        startBody = {};
      }
      expect(startHTTP).toBe(200);
      expect(startBody.ok).toBe(true);
      expect(typeof startBody.animation?.sectorIndex).toBe("number");

      await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
        timeout: 30_000,
      });
      expect(startPostCount).toBe(1);
      await assertNoWheelGameError(page, {
        status: startHTTP,
        body: startBody,
        startPostCount,
      });

      const resultBody = await assertWheelResultInPage(page, {
        startPostCount,
        startHTTP,
        startOk: startBody.ok === true,
      });
      expect(typeof resultBody.animation?.sectorIndex).toBe("number");
      expect(resultBody.animation?.prizeDisplayName).toBeTruthy();
      expect(resultBody.animation?.sectorIndex).toBe(
        startBody.animation?.sectorIndex,
      );
      expect(resultBody.bookingSubmitted).not.toBe(true);

      const cookies = await sessionCookiePresence(page);
      expect(cookies.hasVisitorCookie).toBe(true);
      expect(cookies.hasSessionCookie).toBe(true);
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

    const resultRestorePromise = page.waitForResponse(
      (response) =>
        isWheelResultGet(response) &&
        response.url().includes(encodeURIComponent(WHEEL_SLUG)),
    );
    await page.reload();
    await dismissCookieBanner(page);
    const resultRestore = await resultRestorePromise;
    expect(resultRestore.ok()).toBeTruthy();
    const restoreBody = (await resultRestore.json()) as {
      ok?: boolean;
      animation?: { sectorIndex?: number; prizeDisplayName?: string };
      bookingSubmitted?: boolean;
    };
    expect(restoreBody.ok).toBe(true);
    expect(restoreBody.bookingSubmitted).not.toBe(true);
    expect(restoreBody.animation?.prizeDisplayName).toBe(prizeBefore?.trim());

    await expect(page.getByTestId("wheel-complete-button")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("wheel-spin-button")).toHaveCount(0);
    const prizeAfter = await page.getByTestId("wheel-prize-name").textContent();
    expect(prizeAfter).toBe(prizeBefore);

    // PII is not in browser storage — reclaim contact is empty after reload.
    await page.getByTestId("wheel-complete-button").click();
    await choosePrimaryLipsPreferences(page);
    await expect(page.getByTestId("wheel-phone-input")).toHaveValue("");
    await expect(page.getByLabel("Имя")).toHaveValue("");

    const cookies = await sessionCookiePresence(page);
    expect(cookies.hasVisitorCookie).toBe(true);
    expect(cookies.hasSessionCookie).toBe(true);
  });

  test("retry complete does not create duplicate submission UI", async ({
    page,
  }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(7);
    await spinWheel(page, phone);

    let completePostCount = 0;
    const onCompleteResponse = (response: Response) => {
      if (isWheelCompletePost(response)) {
        completePostCount += 1;
      }
    };
    page.on("response", onCompleteResponse);

    try {
      const completeResponsePromise = page.waitForResponse(isWheelCompletePost);
      await page.getByTestId("wheel-complete-button").click();
      const completeResponse = await completeResponsePromise;
      expect(completeResponse.ok()).toBeTruthy();
      const completeBody = (await completeResponse.json()) as { ok?: boolean };
      expect(completeBody.ok).toBe(true);

      await expect(page.getByTestId("wheel-submitted")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("wheel-submitted")).toHaveCount(1);
      await expect(
      page.getByRole("heading", { name: "Заявка отправлена" }),
    ).toBeVisible();
      expect(completePostCount).toBe(1);

      await page.reload();
      await dismissCookieBanner(page);
      await expect(page.getByTestId("wheel-submitted")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("wheel-submitted-status")).toContainText(
        "Заявка уже отправлена",
      );
      await expect(page.getByTestId("wheel-complete-button")).toHaveCount(0);
      await expect(page.getByTestId("wheel-submitted")).toHaveCount(1);
      expect(completePostCount).toBe(1);

      const cookies = await sessionCookiePresence(page);
      expect(cookies.hasVisitorCookie).toBe(true);
      expect(cookies.hasSessionCookie).toBe(true);
    } finally {
      page.off("response", onCompleteResponse);
    }
  });

  test("different interest after success does not change submitted state", async ({
    page,
  }) => {
    await gotoActiveWheel(page);
    const phone = phoneForTest(8);
    await spinWheel(page, phone);

    const completeResponsePromise = page.waitForResponse(isWheelCompletePost);
    await page.getByTestId("wheel-complete-button").click();
    const completeResponse = await completeResponsePromise;
    expect(completeResponse.ok()).toBeTruthy();
    await expect(page.getByTestId("wheel-submitted")).toBeVisible({
      timeout: 30_000,
    });

    const resultBefore = await assertWheelResultInPage(page, {
      startPostCount: 1,
      startHTTP: 200,
      startOk: true,
    });
    expect(resultBefore.bookingSubmitted).toBe(true);
    expect(typeof resultBefore.animation?.sectorIndex).toBe("number");
    expect(resultBefore.animation?.prizeDisplayName).toBeTruthy();

    const retry = await fetchJsonInPage<{
      ok?: boolean;
      error?: string;
      code?: string;
      bookingSubmitted?: boolean;
      prizeDisplayName?: string;
    }>(page, "/api/game/wheel/complete", {
      method: "POST",
      headers: {
        "Idempotency-Key": `e2e-interest-retry-${phone}`,
      },
      body: {
        catalogSlug: WHEEL_SLUG,
        interest: "brows",
        name: TEST_NAME,
        phone: phoneE164(phone),
        personalDataConsent: true,
        offerAcknowledgement: true,
      },
    });
    if (!retry.ok || retry.body.ok !== true) {
      const cookies = await sessionCookiePresence(page);
      const code =
        typeof retry.body.code === "string" ? retry.body.code : "none";
      const error =
        typeof retry.body.error === "string" ? retry.body.error : "none";
      throw new Error(
        [
          "wheel interest-retry complete failed",
          `HTTP ${retry.status}`,
          `code=${code}`,
          `error=${error}`,
          `body=${JSON.stringify(retry.bodyText)}`,
          `hasVisitorCookie=${String(cookies.hasVisitorCookie)}`,
          `hasSessionCookie=${String(cookies.hasSessionCookie)}`,
          `cookieNames=${cookies.cookieNames.join(",")}`,
        ].join("; "),
      );
    }
    expect(retry.status).toBe(200);
    expect(retry.body.bookingSubmitted).toBe(true);
    expect(retry.body.prizeDisplayName).toBe(
      resultBefore.animation?.prizeDisplayName,
    );

    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByTestId("wheel-submitted-status")).toContainText(
      "Заявка уже отправлена",
    );
    await expect(page.getByTestId("wheel-complete-button")).toHaveCount(0);

    const resultAfter = await assertWheelResultInPage(page, {
      startPostCount: 1,
      startHTTP: 200,
      startOk: true,
    });
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

    const idempotencyKeys: string[] = [];
    let completeCalls = 0;
    await page.route("**/api/game/wheel/complete", async (route) => {
      completeCalls += 1;
      const key =
        route.request().headers()["idempotency-key"] ??
        route.request().headers()["Idempotency-Key"] ??
        "";
      idempotencyKeys.push(key);
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
    expect(completeCalls).toBe(1);
    expect(idempotencyKeys[0]?.length ?? 0).toBeGreaterThan(8);

    await page.getByTestId("wheel-complete-button").click();
    await expect(page.getByTestId("wheel-submitted")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Заявка отправлена" }),
    ).toBeVisible();
    await expect(page.getByTestId("wheel-error-alert")).toHaveCount(0);

    expect(completeCalls).toBe(2);
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(idempotencyKeys[1]).toBeTruthy();
  });
});

test.describe("Wheel promo gates", () => {
  test("DRAFT catalog blocked", async ({ page }) => {
    if (!IS_ISOLATED && !WHEEL_DRAFT_SLUG) {
      test.skip(true, "WHEEL_E2E_DRAFT_SLUG not configured");
    }
    expect(WHEEL_DRAFT_SLUG).not.toBe(WHEEL_SLUG);
    expect(WHEEL_DRAFT_SLUG).not.toBe(WHEEL_INVALID_SLUG);

    const response = await page.goto(`/promo/${WHEEL_DRAFT_SLUG}`);
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
    await dismissCookieBanner(page);

    await expect(page.getByTestId("wheel-promo-unavailable")).toBeVisible();
    await expect(page.getByTestId("wheel-promo-invalid-config")).toHaveCount(0);
    await expect(page.getByTestId("wheel-fortune-public")).toHaveCount(0);
    await expect(page.getByTestId("wheel-start-button")).toHaveCount(0);
  });

  test("ACTIVE invalid config blocked", async ({ page }) => {
    if (!IS_ISOLATED && !WHEEL_INVALID_SLUG) {
      test.skip(true, "WHEEL_E2E_INVALID_SLUG not configured");
    }
    expect(WHEEL_INVALID_SLUG).not.toBe(WHEEL_SLUG);
    expect(WHEEL_INVALID_SLUG).not.toBe(WHEEL_DRAFT_SLUG);

    const response = await page.goto(`/promo/${WHEEL_INVALID_SLUG}`);
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
    await dismissCookieBanner(page);

    await expect(page.getByTestId("wheel-promo-invalid-config")).toBeVisible();
    await expect(page.getByTestId("wheel-promo-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("wheel-fortune-public")).toHaveCount(0);
    await expect(page.getByTestId("wheel-start-button")).toHaveCount(0);
  });

  test("ACTIVE valid config opens wheel", async ({ page }) => {
    await gotoActiveWheel(page);
    await expect(page.getByTestId("wheel-fortune-public")).toBeVisible();
    await expect(page.getByTestId("wheel-start-button")).toBeVisible();
    await expect(page.getByTestId("wheel-start-button")).toBeEnabled();
    await expect(page.getByTestId("wheel-error-alert")).toHaveCount(0);
    await expect(page.getByTestId("wheel-promo-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("wheel-promo-invalid-config")).toHaveCount(0);
  });
});

test.describe("Catch-Time regression", () => {
  test("procedure-gift page still loads", async ({ page }) => {
    const response = await page.goto("/promo/procedure-gift");
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
    // Real Catch-Time marker — must not pass on a generic error/empty shell.
    await expect(page.locator(".poimay-game")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#screen-start")).toBeVisible();
    await expect(page.getByTestId("wheel-fortune-public")).toHaveCount(0);
  });
});
