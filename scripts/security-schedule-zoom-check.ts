/**
 * Unit/static checks for schedule content zoom (buttons, clamp, pinch math, CSS zoom).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEDULE_ZOOM_DEFAULT,
  SCHEDULE_ZOOM_MAX,
  SCHEDULE_ZOOM_MIN,
  SCHEDULE_ZOOM_STEP,
  canResetScheduleZoom,
  clampScheduleZoom,
  formatScheduleZoomPercent,
  stepScheduleZoom,
  touchDistance,
  zoomFromPinch,
} from "../src/lib/schedule/schedule-zoom";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertMath(): void {
  assert.equal(SCHEDULE_ZOOM_MIN, 1);
  assert.equal(SCHEDULE_ZOOM_MAX, 2);
  assert.equal(SCHEDULE_ZOOM_STEP, 0.1);
  assert.equal(clampScheduleZoom(0.5), 1);
  assert.equal(clampScheduleZoom(3), 2);
  assert.equal(clampScheduleZoom(Number.NaN), SCHEDULE_ZOOM_DEFAULT);
  assert.equal(stepScheduleZoom(1, 1), 1.1);
  assert.equal(stepScheduleZoom(2, 1), 2);
  assert.equal(stepScheduleZoom(1, -1), 1);
  assert.equal(formatScheduleZoomPercent(1.2), "120%");
  assert.equal(canResetScheduleZoom(1), false);
  assert.equal(canResetScheduleZoom(1.5), true);

  assert.equal(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }), 5);
  assert.equal(zoomFromPinch(1, 100, 200), 2);
  assert.equal(zoomFromPinch(1, 100, 50), 1);
  assert.equal(zoomFromPinch(1.5, 0, 100), 1.5);
}

function assertSourceContracts(): void {
  const table = read("src/components/schedule/schedule-month-table.tsx");
  assert.match(table, /style=\{\{\s*zoom\s*\}\}/);
  assert.doesNotMatch(table, /transform:\s*scale/);
  assert.match(table, /data-testid="schedule-month-table-content"/);
  assert.match(table, /scrollRef/);

  const view = read("src/components/schedule/schedule-readonly-month-view.tsx");
  assert.match(view, /ScheduleZoomControls/);
  assert.match(view, /useScheduleZoom/);
  assert.match(view, /contentZoom=\{zoom\}/);

  const hook = read("src/hooks/use-schedule-zoom.ts");
  assert.match(hook, /passive:\s*false/);
  assert.match(hook, /preventDefault/);
  assert.match(hook, /touches\.length !== 2/);

  const controls = read("src/components/schedule/schedule-zoom-controls.tsx");
  assert.match(controls, /aria-label="Уменьшить масштаб"/);
  assert.match(controls, /aria-label="Увеличить масштаб"/);
  assert.match(controls, /data-testid="schedule-zoom-controls"/);

  // Не запрещаем системный zoom через viewport meta.
  const layoutCandidates = [
    "src/app/layout.tsx",
    "src/app/view/schedule/page.tsx",
  ];
  for (const rel of layoutCandidates) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const source = read(rel);
    assert.doesNotMatch(
      source,
      /maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i,
      `${rel}: не запрещать системный zoom`,
    );
  }
}

function main(): void {
  assertMath();
  assertSourceContracts();
  console.log("security-schedule-zoom-check: ok");
}

main();
