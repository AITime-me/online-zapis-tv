import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  addDaysToDateKey,
  formatDateKeyInStudio,
  getStudioNow,
  isValidDateKey,
} from "../src/lib/datetime/date-layer";

/**
 * Регрессия гонки: debounce autosave (PATCH) не должен перезаписать
 * мягкую отмену (DELETE → CANCELLED).
 *
 * Секреты только из env (не логировать!):
 * - E2E_OWNER_EMAIL
 * - E2E_OWNER_PASSWORD
 *
 * Опционально:
 * - PLAYWRIGHT_BASE_URL (см. playwright.config.ts)
 * - E2E_CANCEL_RACE_DATE_KEY (YYYY-MM-DD)
 * - E2E_CANCEL_RACE_MASTER_NAME (по умолчанию «Ксения»)
 */

const CREDENTIALS_MISSING_MESSAGE =
  "Для e2e-теста задайте E2E_OWNER_EMAIL и E2E_OWNER_PASSWORD";

type E2EOwnerCredentials = {
  email: string;
  password: string;
};

function requireE2EOwnerCredentials(): E2EOwnerCredentials {
  const email = process.env.E2E_OWNER_EMAIL?.trim() ?? "";
  const password = process.env.E2E_OWNER_PASSWORD?.trim() ?? "";

  if (!email || !password) {
    throw new Error(CREDENTIALS_MISSING_MESSAGE);
  }

  return { email, password };
}

/** Fail-fast до запуска браузера: без секретов файл не должен открывать UI. */
const ownerCredentials = requireE2EOwnerCredentials();

function resolveCancelRaceDateKey(): string {
  const fromEnv = process.env.E2E_CANCEL_RACE_DATE_KEY?.trim();
  if (fromEnv) {
    if (!isValidDateKey(fromEnv)) {
      throw new Error(
        "E2E_CANCEL_RACE_DATE_KEY должен быть в формате YYYY-MM-DD",
      );
    }
    return fromEnv;
  }

  // Безопасная будущая дата: +7 дней от «сегодня» студии (Asia/Yekaterinburg).
  return addDaysToDateKey(formatDateKeyInStudio(getStudioNow()), 7);
}

const DATE_KEY = resolveCancelRaceDateKey();
const MONTH = DATE_KEY.slice(0, 7);
const MASTER_NAME =
  process.env.E2E_CANCEL_RACE_MASTER_NAME?.trim() || "Ксения";
const CREATE_START = "15:00";

function buildUniqueClientName(): string {
  return `E2E Cancel Race ${Date.now()}`;
}

async function login(page: Page, credentials: E2EOwnerCredentials) {
  await page.goto("/login?callbackUrl=/schedule");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => new URL(url).pathname === "/schedule", {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();
}

function newAppointmentForm(page: Page) {
  return page
    .locator("div.border")
    .filter({ has: page.getByRole("button", { name: "Добавить" }) });
}

async function findAppointmentArticle(
  page: Page,
  clientName: string,
): Promise<Locator> {
  const articles = page.getByRole("dialog").locator("article");
  const count = await articles.count();

  for (let index = 0; index < count; index += 1) {
    const article = articles.nth(index);
    const clientInput = article.getByRole("textbox", { name: "Клиент" });
    if ((await clientInput.count()) === 0) {
      continue;
    }
    if ((await clientInput.inputValue()) === clientName) {
      return article;
    }
  }

  throw new Error("Запись не найдена в редакторе для текущего прогона теста");
}

async function getMasterId(page: Page, masterName: string): Promise<string> {
  const masterId = await page
    .locator("thead th")
    .filter({ hasText: masterName })
    .getAttribute("data-master-id");

  if (!masterId) {
    throw new Error(`Колонка мастера не найдена в таблице: ${masterName}`);
  }
  return masterId;
}

/**
 * Cleanup только записи текущего прогона (по уникальному clientName).
 * Другие записи на ячейке не трогаем.
 */
async function cleanupCurrentTestAppointment(
  page: Page,
  cell: ReturnType<Page["getByTestId"]>,
  clientName: string,
) {
  const cellText = await cell.innerText();
  if (!cellText.includes(clientName)) {
    return;
  }

  await cell.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  const article = await findAppointmentArticle(page, clientName);
  await article.getByRole("button", { name: "Отменить запись" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(cell).not.toContainText(clientName, { timeout: 15_000 });
}

function waitForMonthRefresh(page: Page, monthKey: string): Promise<Response | null> {
  return new Promise((resolve) => {
    const onResponse = (response: Response) => {
      if (
        response.url().includes(`/api/schedule/month?month=${monthKey}`) &&
        response.request().method() === "GET"
      ) {
        page.off("response", onResponse);
        resolve(response);
      }
    };
    page.on("response", onResponse);
    setTimeout(() => {
      page.off("response", onResponse);
      resolve(null);
    }, 15_000);
  });
}

test("отмена записи побеждает отложенный PATCH и не возвращает статус", async ({
  page,
}) => {
  const testClientName = buildUniqueClientName();
  const patchAfterDelete: Array<{ status: number; url: string }> = [];
  let deleteSeen = false;

  page.on("response", (response) => {
    const url = response.url();
    const method = response.request().method();
    if (url.includes("/api/appointments/") && method === "DELETE") {
      deleteSeen = true;
    }
    if (
      deleteSeen &&
      url.includes("/api/appointments/") &&
      method === "PATCH"
    ) {
      patchAfterDelete.push({ status: response.status(), url });
    }
  });

  await login(page, ownerCredentials);
  await page.goto(`/schedule?view=month&month=${MONTH}`);

  const masterId = await getMasterId(page, MASTER_NAME);
  const cell = page.getByTestId(`schedule-cell-${DATE_KEY}-${masterId}`);

  // На уникальное имя cleanup в начале обычно no-op; оставляем на случай retry.
  await cleanupCurrentTestAppointment(page, cell, testClientName);

  await cell.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "+ Запись" }).click();
  await expect(page.getByText("Новая запись")).toBeVisible();

  const createForm = newAppointmentForm(page);
  await createForm.locator('label:has-text("Начало") input').fill(CREATE_START);
  await createForm.locator('label:has-text("Услуга") select').selectOption({
    index: 1,
  });
  await createForm.locator('label:has-text("Клиент") input').fill(testClientName);

  const createMonthRefresh = waitForMonthRefresh(page, MONTH);
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await createMonthRefresh;
  await expect(cell).toContainText(testClientName, { timeout: 15_000 });

  const appointmentArticle = await findAppointmentArticle(page, testClientName);
  const statusSelect = appointmentArticle.locator('label:has-text("Статус") select');
  await expect(statusSelect).toBeVisible();

  // Меняем статус — запускается debounce 500ms. Сразу отменяем до PATCH.
  await statusSelect.selectOption("COMPLETED");
  page.once("dialog", (dialog) => dialog.accept());
  const cancelMonthRefresh = waitForMonthRefresh(page, MONTH);
  await appointmentArticle.getByRole("button", { name: "Отменить запись" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await cancelMonthRefresh;

  // Ждём окно, в котором старый debounce мог бы отправить PATCH.
  await page.waitForTimeout(1200);

  // Любой PATCH после DELETE должен быть отвергнут сервером (или не уйти вовсе).
  for (const entry of patchAfterDelete) {
    expect(
      entry.status,
      `поздний PATCH не должен успешно восстановить запись: ${entry.url}`,
    ).not.toBe(200);
  }

  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cell).not.toContainText(testClientName, { timeout: 15_000 });

  // Перезагрузка: CANCELLED не должен вернуться в активную сетку; слот свободен.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();
  const cellAfterReload = page.getByTestId(`schedule-cell-${DATE_KEY}-${masterId}`);
  await expect(cellAfterReload).not.toContainText(testClientName, {
    timeout: 15_000,
  });

  expect(deleteSeen).toBe(true);
});
