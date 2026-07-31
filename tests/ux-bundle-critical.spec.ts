import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });

const MONTH = "2026-07";
const MOBILE = { width: 390, height: 844 };
const VIEW_TOKEN =
  process.env.SCHEDULE_VIEW_TOKEN?.trim() || "tvoe-vremya-team-2026";

async function dismissCookieBanner(page: Page) {
  const accept = page.getByRole("button", { name: "Понятно" });
  if ((await accept.count()) > 0) {
    await accept.click({ force: true });
  }
}

async function login(page: Page, callbackPath: string) {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
  await page.fill("#email", "owner@example.local");
  await page.fill("#password", "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname === "/schedule", {
    timeout: 30_000,
  });
}

test.describe("UX bundle A — client autocomplete", () => {
  test("mouse / Enter / mobile pick close suggest; unlink works", async ({
    page,
  }) => {
    await login(page, `/schedule?view=month&month=${MONTH}`);
    await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible({
      timeout: 30_000,
    });

    const masterHeader = page.locator("thead th[data-master-id]").first();
    const masterId = await masterHeader.getAttribute("data-master-id");
    expect(masterId).toBeTruthy();

    const cell = page.getByTestId(`schedule-cell-2026-07-03-${masterId}`);
    await expect(cell).toBeVisible({ timeout: 30_000 });
    await cell.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole("button", { name: "+ Запись" }).click();
    const addButton = dialog.getByRole("button", { name: "Добавить" });
    await expect(addButton).toBeVisible({ timeout: 15_000 });
    const nameInput = dialog.locator('input[id*="clientName"]').last();
    await expect(nameInput).toBeVisible();

    await nameInput.fill("");
    await nameInput.pressSequentially("Ан", { delay: 40 });
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(1, {
      timeout: 10_000,
    });

    const firstOption = page
      .getByTestId("client-suggest-list")
      .locator('[data-testid^="client-suggest-option-"]')
      .first();
    await expect(firstOption).toBeVisible();
    const pickedName = (await firstOption.locator("span").first().textContent())?.trim();
    expect(pickedName).toBeTruthy();

    await firstOption.click();
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(nameInput).toHaveValue(pickedName!);

    await page.waitForTimeout(450);
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(0);

    const unlink = dialog.getByRole("button", { name: "Снять связь" });
    await expect(unlink).toBeVisible();
    await expect(unlink).toBeEnabled();
    await unlink.click();
    await expect(unlink).toHaveCount(0);
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(0);

    await nameInput.fill("");
    await nameInput.pressSequentially("Ан", { delay: 40 });
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(1, {
      timeout: 10_000,
    });
    await nameInput.press("Enter");
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(dialog.getByRole("button", { name: "Снять связь" })).toBeVisible();

    await page.setViewportSize(MOBILE);
    await dialog.getByRole("button", { name: "Снять связь" }).click();
    await expect(dialog.getByRole("button", { name: "Снять связь" })).toHaveCount(0);
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(0);
    await nameInput.fill("");
    await nameInput.pressSequentially("Ан", { delay: 40 });
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(1, {
      timeout: 10_000,
    });
    await page
      .getByTestId("client-suggest-list")
      .locator('[data-testid^="client-suggest-option-"]')
      .first()
      .click({ force: true });
    await expect(page.getByTestId("client-suggest-list")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(dialog.getByRole("button", { name: "Снять связь" })).toBeVisible();
    await expect(addButton).toBeVisible();
  });
});

test.describe("UX bundle B — /view/schedule zoom", () => {
  test("mobile zoom buttons, bounds, scroll-area, nav; desktop unaffected path", async ({
    page,
  }) => {
    const token = VIEW_TOKEN;
    test.skip(!token, "SCHEDULE_VIEW_TOKEN не задан — view zoom e2e пропущен");

    await page.setViewportSize(MOBILE);
    await page.goto(
      `/view/schedule?token=${encodeURIComponent(token)}&month=${MONTH}`,
    );
    await expect(page.getByTestId("schedule-readonly-month-view")).toBeVisible({
      timeout: 30_000,
    });

    const scroll = page.getByTestId("schedule-month-table-scroll");
    const content = page.getByTestId("schedule-month-table-content");
    const zoomIn = page.getByTestId("schedule-zoom-in");
    const zoomOut = page.getByTestId("schedule-zoom-out");
    const zoomValue = page.getByTestId("schedule-zoom-value");

    await expect(page.getByTestId("schedule-zoom-controls")).toBeVisible();
    await expect(zoomValue).toHaveText("100%");

    const before = await scroll.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
    }));

    await zoomIn.click();
    await expect(zoomValue).toHaveText("110%");
    await expect(scroll).toHaveAttribute("data-schedule-zoom", "1.1");

    const after = await scroll.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
    }));
    expect(after.scrollWidth).toBeGreaterThanOrEqual(before.scrollWidth);
    expect(after.scrollHeight).toBeGreaterThanOrEqual(before.scrollHeight);

    await scroll.evaluate((el) => {
      el.scrollLeft = Math.min(40, el.scrollWidth - el.clientWidth);
      el.scrollTop = Math.min(40, el.scrollHeight - el.clientHeight);
    });
    const scrolled = await scroll.evaluate((el) => ({
      left: el.scrollLeft,
      top: el.scrollTop,
    }));
    expect(scrolled.left + scrolled.top).toBeGreaterThan(0);

    await expect(page.getByLabel("Предыдущий месяц")).toBeVisible();
    await expect(page.getByLabel("Следующий месяц")).toBeVisible();

    for (let i = 0; i < 15; i += 1) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
    }
    await expect(zoomValue).toHaveText("200%");
    await expect(zoomIn).toBeDisabled();

    await page.getByTestId("schedule-zoom-reset").click();
    await expect(zoomValue).toHaveText("100%");
    await expect(zoomOut).toBeDisabled();

    const appointment = content.locator("article, [data-kind='appointment']").first();
    if ((await appointment.count()) > 0) {
      await appointment.click({ force: true });
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("schedule-zoom-controls")).toBeVisible();
    await expect(zoomValue).toHaveText("100%");
  });
});

test.describe("UX bundle C — report problem + booking smoke", () => {
  test("modal a11y, validation, pending lock, success/error paths", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/booking");
    await dismissCookieBanner(page);
    await expect(page.getByTestId("report-problem-entry")).toBeVisible({
      timeout: 30_000,
    });

    const openButton = page.getByRole("button", { name: "Сообщить о проблеме" });
    await openButton.focus();
    await openButton.press("Enter");

    const dialog = page.getByTestId("report-problem-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();

    await dismissCookieBanner(page);
    await openButton.click();
    await expect(dialog).toBeVisible();

    const submit = page.getByTestId("report-problem-submit");
    await submit.click();
    await expect(page.getByTestId("report-problem-error")).toBeVisible();

    await dialog.locator('input[autocomplete="tel-national"]').fill("9991234567");
    await dialog.locator("textarea").fill("Не получается выбрать мастера в форме записи");
    await dialog.locator("#problem-report-consent").check();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/booking/problem-report", async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          id: "e2e-fake-id",
          message: "Спасибо! Сообщение отправлено. Мы свяжемся с вами.",
        }),
      });
    });

    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText(/Отправка/);
    const closeDuringPending = dialog.getByRole("button", { name: "Закрыть" });
    await expect(closeDuringPending).toBeDisabled();
    await expect(closeDuringPending).not.toBeFocused();
    await submit.click({ force: true });
    await expect(submit).toHaveText(/Отправка/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(page.getByTestId("report-problem-success")).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByTestId("report-problem-success")
      .getByRole("button", { name: "Закрыть" })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();

    await dismissCookieBanner(page);
    await openButton.click();
    await page.unroute("**/api/booking/problem-report");
    await page.route("**/api/booking/problem-report", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Серверная ошибка" }),
      });
    });
    await dialog.locator('input[autocomplete="tel-national"]').fill("9991234567");
    await dialog.locator("textarea").fill("Повторная проверка ошибки сервера");
    await dialog.locator("#problem-report-consent").check();
    await page.getByTestId("report-problem-submit").click();
    await expect(page.getByTestId("report-problem-error")).toBeVisible();

    await dialog.locator("textarea").focus();
    const submitBox = await page.getByTestId("report-problem-submit").boundingBox();
    expect(submitBox).toBeTruthy();
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(MOBILE.height + 1);

    await page.keyboard.press("Escape");
    await expect(
      page.getByText(/Онлайн-запись|Выберите|мастер|услуг/i).first(),
    ).toBeVisible();
  });
});
