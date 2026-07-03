import { expect, test, type Page } from "@playwright/test";

const TEST_CLIENT = "E2E View Polling Test";
const DATE_KEY = "2026-07-03";
const MONTH = "2026-07";
const VIEW_TOKEN =
  process.env.SCHEDULE_VIEW_TOKEN ?? "tvoe-vremya-team-2026";

async function loginSchedule(page: Page) {
  await page.goto("/login?callbackUrl=/schedule");
  await page.fill("#email", "owner@example.local");
  await page.fill("#password", "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => new URL(url).pathname === "/schedule", {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible({
    timeout: 30_000,
  });
}

async function getKseniaMasterId(page: Page): Promise<string> {
  const masterId = await page
    .locator("thead th")
    .filter({ hasText: "Ксения" })
    .getAttribute("data-master-id");
  if (!masterId) {
    throw new Error("Колонка Ксения не найдена");
  }
  return masterId;
}

async function cleanupTestClient(page: Page, cell: ReturnType<Page["getByTestId"]>) {
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

async function createTestAppointment(page: Page, cell: ReturnType<Page["getByTestId"]>) {
  await cell.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "+ Запись" }).click();

  const newAppointmentForm = page
    .locator("div.border")
    .filter({ has: page.getByRole("button", { name: "Добавить" }) });
  await newAppointmentForm
    .locator('label:has-text("Услуга") select')
    .selectOption({ index: 1 });
  await newAppointmentForm
    .locator('label:has-text("Клиент") input')
    .fill(TEST_CLIENT);
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
}

test("запись появляется в /schedule сразу и в /view/schedule через polling", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await loginSchedule(page);
  await page.goto(`/schedule?view=month&month=${MONTH}`);
  await expect(page.locator("table")).toBeVisible();

  const kseniaId = await getKseniaMasterId(page);
  const scheduleCell = page.getByTestId(`schedule-cell-${DATE_KEY}-${kseniaId}`);

  await cleanupTestClient(page, scheduleCell);

  const viewPage = await page.context().newPage();

  await viewPage.goto(
    `/view/schedule?token=${encodeURIComponent(VIEW_TOKEN)}&month=${MONTH}`,
  );
  await expect(viewPage.getByText("Только просмотр")).toBeVisible();
  await expect(viewPage.locator("table")).toBeVisible();

  const viewCell = viewPage.getByTestId(`schedule-cell-${DATE_KEY}-${kseniaId}`);
  await expect(viewCell).not.toContainText(TEST_CLIENT);

  await createTestAppointment(page, scheduleCell);

  await expect(scheduleCell).toContainText(TEST_CLIENT, { timeout: 15_000 });

  await viewPage.bringToFront();
  await expect(viewCell).toContainText(TEST_CLIENT, { timeout: 45_000 });

  await scheduleCell.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Отменить запись" }).click();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();

  await expect(scheduleCell).not.toContainText(TEST_CLIENT, { timeout: 15_000 });
  await expect(viewCell).not.toContainText(TEST_CLIENT, { timeout: 45_000 });

  await viewPage.close();
});
