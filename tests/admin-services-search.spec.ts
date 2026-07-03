import { expect, test, type Page } from "@playwright/test";

const SEED_CATEGORY_NAMES = ["Волосы", "Ногти"];
const SEED_SERVICE_NAMES = ["Стрижка", "Маникюр"];

async function loginServices(page: Page) {
  await page.goto("/login?callbackUrl=/admin/services");
  await page.fill("#email", "owner@example.local");
  await page.fill("#password", "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => new URL(url).pathname === "/admin/services", {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Услуги" })).toBeVisible();
}

function searchInput(page: Page) {
  return page.getByPlaceholder("Например: плазма, брови, массаж...");
}

function tableBody(page: Page) {
  return page.locator("table tbody");
}

async function assertNoSeedTestServices(page: Page) {
  for (const category of SEED_CATEGORY_NAMES) {
    await expect(tableBody(page).getByText(category, { exact: true })).toHaveCount(0);
  }
  for (const name of SEED_SERVICE_NAMES) {
    await expect(tableBody(page).getByText(name, { exact: true })).toHaveCount(0);
  }
}

test("поиск услуг в /admin/services и отсутствие seed-тестовых услуг", async ({
  page,
}) => {
  await loginServices(page);

  await expect(page.getByText("Показано 88 из 88 услуг")).toBeVisible();

  const search = searchInput(page);

  await search.fill("Velvet");
  await expect(page.getByText(/Показано \d+ из 88 услуг/)).toBeVisible();
  await expect(tableBody(page)).toContainText("Velvet");
  await assertNoSeedTestServices(page);

  await search.fill("плазма");
  await expect(page.getByText(/Показано \d+ из 88 услуг/)).toBeVisible();
  const plasmaCount = await tableBody(page).locator("tr").count();
  expect(plasmaCount).toBeGreaterThan(0);
  await expect(tableBody(page).getByText(/плазма/i).first()).toBeVisible();
  await assertNoSeedTestServices(page);

  await search.fill("релатокс");
  await expect(page.getByText(/Показано \d+ из 88 услуг/)).toBeVisible();
  await expect(tableBody(page)).toContainText("Релатокс");
  await assertNoSeedTestServices(page);

  await search.fill("");
  await expect(page.getByText("Показано 88 из 88 услуг")).toBeVisible();
  await assertNoSeedTestServices(page);
});
