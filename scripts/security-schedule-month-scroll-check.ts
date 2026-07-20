/**
 * Контракт вертикальной прокрутки месячного расписания на мобильных.
 * Защищает от:
 * - `maxHeight: calc(100vh - …)`
 * - конфликтующих Tailwind `h-screen` / `h-dvh`
 * - разрыва flex-цепочки `flex-1 min-h-0`
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertHasFlexFill(source: string, label: string): void {
  assert.match(
    source,
    /min-h-0[\s\S]{0,80}flex-1|flex-1[\s\S]{0,80}min-h-0/,
    `${label}: нужен flex-1 min-h-0`,
  );
}

function assertViewportCssRule(): void {
  const css = read("src/app/globals.css");

  // Базовый fallback.
  assert.match(
    css,
    /\.schedule-viewport-height\s*\{[^}]*height:\s*100vh\s*;/s,
    "globals.css: .schedule-viewport-height должен задавать height: 100vh",
  );

  // dvh только внутри @supports — иначе Lightning CSS схлопывает дубли в одном правиле.
  assert.match(
    css,
    /@supports\s*\(\s*height:\s*100dvh\s*\)\s*\{[\s\S]*?\.schedule-viewport-height\s*\{[^}]*height:\s*100dvh\s*;/s,
    "globals.css: 100dvh должен быть внутри @supports (height: 100dvh)",
  );
}

function assertScheduleRootsUseViewportClass(): void {
  const internal = read("src/app/(internal)/schedule/page.tsx");
  const viewOnly = read("src/app/view/schedule/page.tsx");

  for (const [label, source] of [
    ["/schedule", internal],
    ["/view/schedule", viewOnly],
  ] as const) {
    assert.match(
      source,
      /schedule-viewport-height/,
      `${label}: root main должен использовать schedule-viewport-height`,
    );
    assert.doesNotMatch(
      source,
      /\bh-screen\b/,
      `${label}: запрещён h-screen (конфликт с dvh в Tailwind cascade)`,
    );
    assert.doesNotMatch(
      source,
      /\bh-dvh\b/,
      `${label}: запрещён h-dvh utility — только явный CSS-класс`,
    );
    assert.doesNotMatch(
      source,
      /h-screen\s+h-dvh|h-dvh\s+h-screen/,
      `${label}: запрещено сочетание h-screen h-dvh`,
    );
    assert.match(
      source,
      /overflow-hidden/,
      `${label}: overflow-hidden на root, скролл внутри таблицы`,
    );
    assertHasFlexFill(source, `${label} page slot`);
  }
}

function assertNoFixedVhClip(): void {
  const table = read("src/components/schedule/schedule-month-table.tsx");
  assert.doesNotMatch(table, /100vh/, "ScheduleMonthTable: без 100vh");
  assert.doesNotMatch(
    table,
    /maxHeight\s*:/,
    "ScheduleMonthTable: без inline maxHeight",
  );
  assert.doesNotMatch(
    table,
    /max-h-\[calc\(100vh/,
    "ScheduleMonthTable: без max-h calc(100vh…)",
  );
  assert.match(
    table,
    /data-testid="schedule-month-table-scroll"/,
    "scroll-контейнер testid",
  );
  assertHasFlexFill(table, "ScheduleMonthTable");
  assert.match(
    table,
    /safe-area-inset-bottom/,
    "safe-area padding снизу",
  );
}

function assertFlexChainComplete(): void {
  assertHasFlexFill(
    read("src/components/schedule/schedule-month-view.tsx"),
    "ScheduleMonthView",
  );
  assertHasFlexFill(
    read("src/components/schedule/schedule-readonly-month-view.tsx"),
    "ScheduleReadonlyMonthView",
  );
  const day = read("src/components/schedule/schedule-day-view.tsx");
  assertHasFlexFill(day, "ScheduleDayView");
  assert.match(
    day,
    /data-testid="schedule-day-table-scroll"/,
    "day scroll testid",
  );
}

function assertScrollAxesAndNoWrapperYScroll(): void {
  const styles = read("src/components/schedule/schedule-month-table-styles.ts");
  assert.match(styles, /overflow-x-auto/, "горизонтальный скролл");
  assert.match(styles, /overflow-y-auto/, "вертикальный скролл таблицы");
  assert.match(styles, /touch-pan-x/, "touch X");
  assert.match(styles, /touch-pan-y/, "touch Y");
  assert.match(styles, /sticky top-0 left-0/, "sticky угол");
  assert.match(styles, /sticky top-0/, "sticky thead");
  assert.match(styles, /sticky left-0/, "sticky дата");

  // Wrappers страницы/view не должны добавлять второй overflow-y-auto.
  const wrappers = [
    "src/app/(internal)/schedule/page.tsx",
    "src/app/view/schedule/page.tsx",
    "src/components/schedule/schedule-month-view.tsx",
    "src/components/schedule/schedule-readonly-month-view.tsx",
  ];
  for (const rel of wrappers) {
    const source = read(rel);
    assert.doesNotMatch(
      source,
      /overflow-y-auto/,
      `${rel}: без второго overflow-y-auto в wrapper-цепочке`,
    );
  }
}

function assertMobileNavDoesNotWrapOnSchedule(): void {
  const nav = read("src/components/admin/internal-workspace-nav.tsx");
  assert.match(
    nav,
    /variant === "schedule"[\s\S]*flex-nowrap[\s\S]*overflow-x-auto/,
    "schedule nav: одна строка с горизонтальным скроллом",
  );
  const header = read("src/components/schedule/schedule-workspace-header.tsx");
  assert.match(
    header,
    /LogoutButton/,
    "logout остаётся в header",
  );
  assert.match(
    header,
    /shrink-0[\s\S]*LogoutButton|LogoutButton[\s\S]*shrink-0/,
    "logout не должен уезжать в горизонтальный скролл nav",
  );
}

function assertBuiltCssViewportRule(): void {
  const cssDir = path.join(ROOT, ".next", "static", "css");
  assert.ok(
    fs.existsSync(cssDir),
    "отсутствует .next/static/css — сначала выполните npm run build (проверка generated CSS не пропускается)",
  );

  const cssFiles = fs
    .readdirSync(cssDir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => path.join(cssDir, name));
  assert.ok(cssFiles.length > 0, "в .next/static/css нет css-файлов — нужен build");

  let combined = "";
  for (const file of cssFiles) {
    combined += fs.readFileSync(file, "utf8");
  }

  assert.match(
    combined,
    /\.schedule-viewport-height\{height:100vh\}/,
    "production CSS: базовый .schedule-viewport-height{height:100vh}",
  );
  assert.match(
    combined,
    /@supports\s*\(\s*height:\s*100dvh\s*\)\s*\{\s*\.schedule-viewport-height\{height:100dvh\}/,
    "production CSS: @supports (height:100dvh) переопределяет на 100dvh",
  );

  // Убеждаемся, что на schedule pages нет зависимости от .h-screen для высоты.
  const internal = read("src/app/(internal)/schedule/page.tsx");
  const viewOnly = read("src/app/view/schedule/page.tsx");
  assert.doesNotMatch(internal, /\bh-screen\b/);
  assert.doesNotMatch(viewOnly, /\bh-screen\b/);
}

function main(): void {
  assertViewportCssRule();
  assertScheduleRootsUseViewportClass();
  assertNoFixedVhClip();
  assertFlexChainComplete();
  assertScrollAxesAndNoWrapperYScroll();
  assertMobileNavDoesNotWrapOnSchedule();
  assertBuiltCssViewportRule();
  console.log("security-schedule-month-scroll-check: OK");
}

main();
