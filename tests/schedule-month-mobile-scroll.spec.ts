import { expect, test, type Page } from "@playwright/test";

/** Samsung Galaxy-like portrait — воспроизводит обрезание низа месяца. */
const MOBILE_PORTRAIT = { width: 360, height: 740 };
/** Низкий landscape — риск tall header + короткий scrollport. */
const MOBILE_LANDSCAPE = { width: 740, height: 360 };

const MONTH = "2026-07";
const LAST_DAY = "2026-07-31";

type VisibilityProbe = {
  visualHeight: number;
  rowTop: number;
  rowBottom: number;
  rootBottom: number;
  rowInVisualViewport: boolean;
  rootBottomInVisualViewport: boolean;
  pageScrollExcess: number;
  tableMaxScrollTop: number;
  tableMaxScrollLeft: number;
};

async function loginSchedule(page: Page) {
  await page.goto(
    `/login?callbackUrl=${encodeURIComponent(`/schedule?view=month&month=${MONTH}`)}`,
  );
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

async function probeLastDayVisibility(page: Page): Promise<VisibilityProbe> {
  const scroll = page.getByTestId("schedule-month-table-scroll");
  await expect(scroll).toBeVisible({ timeout: 30_000 });

  const lastRow = page.locator(`tr[data-date-key="${LAST_DAY}"]`);
  await expect(lastRow).toHaveCount(1);

  await lastRow.evaluate((el) => {
    el.scrollIntoView({ block: "end", inline: "nearest" });
  });

  // Дать layout/sticky стабилизироваться после scrollIntoView.
  await page.waitForTimeout(50);

  return lastRow.evaluate((el) => {
    const scrollRoot = el.closest(
      '[data-testid="schedule-month-table-scroll"]',
    );
    if (!(scrollRoot instanceof HTMLElement)) {
      throw new Error("scroll root not found");
    }

    const visualHeight =
      window.visualViewport?.height ?? window.innerHeight;
    const row = el.getBoundingClientRect();
    const root = scrollRoot.getBoundingClientRect();
    const scrolling = document.scrollingElement;
    const layoutHeight = window.innerHeight;
    const pageScrollExcess = scrolling
      ? scrolling.scrollHeight - layoutHeight
      : 0;

    return {
      visualHeight,
      rowTop: row.top,
      rowBottom: row.bottom,
      rootBottom: root.bottom,
      rowInVisualViewport:
        row.top >= -1 && row.bottom <= visualHeight + 1,
      rootBottomInVisualViewport: root.bottom <= visualHeight + 1,
      pageScrollExcess,
      tableMaxScrollTop: scrollRoot.scrollHeight - scrollRoot.clientHeight,
      tableMaxScrollLeft: scrollRoot.scrollWidth - scrollRoot.clientWidth,
    };
  });
}

async function assertHorizontalScrollWorks(page: Page) {
  const scroll = page.getByTestId("schedule-month-table-scroll");
  const before = await scroll.evaluate((el) => el.scrollLeft);
  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const after = await scroll.evaluate((el) => el.scrollLeft);
  expect(after).toBeGreaterThan(before);
}

function assertMonthReachable(probe: VisibilityProbe) {
  expect(
    probe.rootBottomInVisualViewport,
    `низ scroll-root (${probe.rootBottom}) ниже visual viewport (${probe.visualHeight})`,
  ).toBe(true);
  expect(
    probe.rowInVisualViewport,
    `строка 31-го вне visual viewport: top=${probe.rowTop} bottom=${probe.rowBottom} vh=${probe.visualHeight}`,
  ).toBe(true);
  expect(probe.rowTop).toBeGreaterThanOrEqual(-1);
  expect(probe.rowBottom).toBeLessThanOrEqual(probe.visualHeight + 1);
  expect(probe.tableMaxScrollTop).toBeGreaterThan(0);
  expect(probe.tableMaxScrollLeft).toBeGreaterThan(0);
  // Страница не должна конкурировать вертикальным скроллом (допуск на subpixel/chrome).
  expect(probe.pageScrollExcess).toBeLessThanOrEqual(2);
}

test.describe("schedule month mobile scroll (portrait)", () => {
  test.use({
    viewport: MOBILE_PORTRAIT,
    hasTouch: true,
    isMobile: true,
  });

  test("internal: last day visible in visual viewport; horizontal scroll; no page Y scroll", async ({
    page,
  }) => {
    await loginSchedule(page);
    await page.goto(`/schedule?view=month&month=${MONTH}`);

    const mainHeight = await page.locator("main").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { height: cs.height, className: el.className };
    });
    expect(mainHeight.className).toContain("schedule-viewport-height");

    const probe = await probeLastDayVisibility(page);
    assertMonthReachable(probe);
    await assertHorizontalScrollWorks(page);
  });
});

test.describe("schedule month mobile scroll (landscape)", () => {
  test.use({
    viewport: MOBILE_LANDSCAPE,
    hasTouch: true,
    isMobile: true,
  });

  test("internal landscape: last day still in visual viewport; header/nav remain usable", async ({
    page,
  }) => {
    await loginSchedule(page);
    await page.goto(`/schedule?view=month&month=${MONTH}`);

    await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Выйти" })).toBeVisible();

    const tableBox = await page.getByTestId("schedule-month-table-scroll").boundingBox();
    expect(tableBox).toBeTruthy();
    expect(tableBox!.height).toBeGreaterThan(80);

    const probe = await probeLastDayVisibility(page);
    assertMonthReachable(probe);
    await assertHorizontalScrollWorks(page);
  });
});

test.describe("schedule readonly month mobile scroll", () => {
  test.use({
    viewport: MOBILE_PORTRAIT,
    hasTouch: true,
    isMobile: true,
  });

  test("readonly: last day visible when SCHEDULE_VIEW_TOKEN is set", async ({
    page,
  }) => {
    const token = process.env.SCHEDULE_VIEW_TOKEN?.trim();
    test.skip(
      !token || token.length < 8,
      "SCHEDULE_VIEW_TOKEN не задан в env — readonly e2e пропущен (не PASS)",
    );

    await page.goto(
      `/view/schedule?token=${encodeURIComponent(token!)}&month=${MONTH}`,
    );
    await expect(page.getByTestId("schedule-readonly-month-view")).toBeVisible({
      timeout: 30_000,
    });

    const probe = await probeLastDayVisibility(page);
    assertMonthReachable(probe);
    await assertHorizontalScrollWorks(page);
  });
});
