import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

const TEST_CLIENT = "E2E Schedule Edit Test";
const DATE_KEY = "2026-07-03";
const MONTH = "2026-07";
const CREATE_START = "13:00";
const EDITED_START = "14:00";

type NetworkLog = {
  postAppointments: boolean;
  patchAppointments: boolean;
  getCell: boolean;
  getMonth: boolean;
};

async function login(page: Page) {
  await page.goto("/login?callbackUrl=/schedule");
  await page.fill("#email", "owner@example.local");
  await page.fill("#password", "password123");
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

  throw new Error(`Запись не найдена в редакторе: ${clientName}`);
}

async function getKseniaMasterId(page: Page): Promise<string> {
  const masterId = await page
    .locator("thead th")
    .filter({ hasText: "Ксения" })
    .getAttribute("data-master-id");

  if (!masterId) {
    throw new Error("Колонка Ксения не найдена в таблице");
  }
  return masterId;
}

async function cleanupExistingTestAppointment(
  page: Page,
  cell: ReturnType<Page["getByTestId"]>,
) {
  const cellText = await cell.innerText();
  if (!cellText.includes(TEST_CLIENT)) {
    return;
  }

  await cell.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("dialog").getByRole("button", { name: "Отменить запись" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(cell).not.toContainText(TEST_CLIENT, { timeout: 15_000 });
}

function attachNetworkLogger(page: Page): {
  log: NetworkLog;
  waitForMonthRefresh: () => Promise<Response | null>;
} {
  const log: NetworkLog = {
    postAppointments: false,
    patchAppointments: false,
    getCell: false,
    getMonth: false,
  };

  let monthRefreshResolve: ((response: Response | null) => void) | null = null;

  page.on("response", (response) => {
    const url = response.url();
    const method = response.request().method();

    if (url.includes("/api/appointments") && method === "POST") {
      log.postAppointments = true;
    }
    if (url.includes("/api/appointments/") && method === "PATCH") {
      log.patchAppointments = true;
    }
    if (url.includes("/api/schedule/cell")) {
      log.getCell = true;
    }
    if (url.includes(`/api/schedule/month?month=${MONTH}`)) {
      log.getMonth = true;
      monthRefreshResolve?.(response);
      monthRefreshResolve = null;
    }
  });

  return {
    log,
    waitForMonthRefresh: () =>
      new Promise((resolve) => {
        monthRefreshResolve = resolve;
        setTimeout(() => {
          if (monthRefreshResolve) {
            monthRefreshResolve = null;
            resolve(null);
          }
        }, 15_000);
      }),
  };
}

test("месячная таблица обновляется без F5 после редактирования и отмены записи", async ({
  page,
}) => {
  const { log, waitForMonthRefresh } = attachNetworkLogger(page);

  await login(page);
  await page.goto(`/schedule?view=month&month=${MONTH}`);

  const kseniaId = await getKseniaMasterId(page);
  const cell = page.getByTestId(`schedule-cell-${DATE_KEY}-${kseniaId}`);

  await cleanupExistingTestAppointment(page, cell);

  await cell.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "+ Запись" }).click();
  await expect(page.getByText("Новая запись")).toBeVisible();

  const createForm = newAppointmentForm(page);
  await createForm.locator('label:has-text("Начало") input').fill(CREATE_START);
  await createForm.locator('label:has-text("Услуга") select').selectOption({
    index: 1,
  });
  await createForm.locator('label:has-text("Клиент") input').fill(TEST_CLIENT);

  const createMonthRefresh = waitForMonthRefresh();
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await createMonthRefresh;

  await expect(cell).toContainText(TEST_CLIENT, { timeout: 15_000 });
  await expect(cell).toContainText(CREATE_START, { timeout: 15_000 });

  const appointmentArticle = await findAppointmentArticle(page, TEST_CLIENT);
  const editMonthRefresh = waitForMonthRefresh();
  await appointmentArticle.locator('label:has-text("Начало") input').fill(EDITED_START);
  await appointmentArticle.locator('label:has-text("Начало") input').blur();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await editMonthRefresh;

  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(cell).toContainText(TEST_CLIENT, { timeout: 15_000 });
  await expect(cell).toContainText(EDITED_START, { timeout: 15_000 });
  await expect(cell).not.toContainText(`${CREATE_START} `, { timeout: 15_000 });

  expect(log.postAppointments).toBe(true);
  expect(log.patchAppointments).toBe(true);
  expect(log.getCell).toBe(true);
  expect(log.getMonth).toBe(true);

  await cell.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  const cancelMonthRefresh = waitForMonthRefresh();
  await page.getByRole("dialog").getByRole("button", { name: "Отменить запись" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await cancelMonthRefresh;

  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cell).not.toContainText(TEST_CLIENT, { timeout: 15_000 });

  console.log("NETWORK_LOG", JSON.stringify(log));
});
