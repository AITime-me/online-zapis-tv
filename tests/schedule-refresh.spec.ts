import { expect, test, type Page, type Response } from "@playwright/test";

const TEST_CLIENT = "E2E Schedule Refresh Test";
const DATE_KEY = "2026-07-03";
const MONTH = "2026-07";

type NetworkLog = {
  postAppointments: boolean;
  getCell: boolean;
  getMonth: boolean;
  monthHadTestClient: boolean;
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
  await page.getByRole("button", { name: "Отменить запись" }).click();
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
    getCell: false,
    getMonth: false,
    monthHadTestClient: false,
  };

  let monthRefreshResolve: ((response: Response | null) => void) | null = null;

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/appointments") && response.request().method() === "POST") {
      log.postAppointments = true;
    }
    if (url.includes("/api/schedule/cell")) {
      log.getCell = true;
    }
    if (url.includes(`/api/schedule/month?month=${MONTH}`)) {
      log.getMonth = true;
      try {
        const payload = await response.json();
        const jsonText = JSON.stringify(payload);
        if (jsonText.includes(TEST_CLIENT)) {
          log.monthHadTestClient = true;
        }
      } catch {
        // ignore parse errors
      }
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

test("месячная таблица обновляется без F5 после создания и отмены записи", async ({
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

  const newAppointmentForm = page
    .locator("div.border")
    .filter({ has: page.getByRole("button", { name: "Добавить" }) });
  await newAppointmentForm.locator('label:has-text("Услуга") select').selectOption({
    index: 1,
  });
  await newAppointmentForm.locator('label:has-text("Клиент") input').fill(TEST_CLIENT);

  const monthRefreshPromise = waitForMonthRefresh();
  await page.getByRole("button", { name: "Добавить" }).click();

  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await monthRefreshPromise;

  await expect(cell).toContainText(TEST_CLIENT, { timeout: 15_000 });

  expect(log.postAppointments).toBe(true);
  expect(log.getCell).toBe(true);
  expect(log.getMonth).toBe(true);
  expect(log.monthHadTestClient).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  const cancelMonthRefresh = waitForMonthRefresh();
  await page.getByRole("button", { name: "Отменить запись" }).click();
  await cancelMonthRefresh;

  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(cell).not.toContainText(TEST_CLIENT, { timeout: 15_000 });

  console.log("NETWORK_LOG", JSON.stringify(log));
});
