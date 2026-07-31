/**
 * UI check: zoom controls + ScheduleMonthTable CSS zoom / scroll contract.
 * Avoids Next.js <Link> by testing table+controls directly.
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { ScheduleZoomControls } from "../src/components/schedule/schedule-zoom-controls";
import { ScheduleMonthTable } from "../src/components/schedule/schedule-month-table";
import {
  clampScheduleZoom,
  stepScheduleZoom,
  SCHEDULE_ZOOM_DEFAULT,
} from "../src/lib/schedule/schedule-zoom";
import type { ScheduleMonthData } from "../src/types/schedule-month";

const monthData: ScheduleMonthData = {
  month: "2026-07",
  studioToday: "2026-07-03",
  masters: [
    {
      id: "master-a",
      internalName: "Мастер А",
      publicName: "Анна",
    },
  ],
  days: [
    {
      dateKey: "2026-07-03",
      managerNotes: [],
      ownerNotes: [],
      bookingRequests: [],
      masterCells: {
        "master-a": [
          {
            kind: "appointment",
            id: "appt-1",
            masterId: "master-a",
            serviceId: null,
            startsAt: "2026-07-03T10:00:00.000Z",
            endsAt: "2026-07-03T11:00:00.000Z",
            clientName: "Клиент",
            serviceName: "Услуга",
            isBold: false,
            isManualTimeOverride: false,
            status: "CONFIRMED",
            source: "INTERNAL",
            statusCode: "CONFIRMED",
            sourceCode: "INTERNAL",
            masterNote: null,
          },
        ],
      },
    },
  ],
};

function setupDom(): HTMLElement {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/" },
  );
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.navigator = dom.window.navigator;
  g.HTMLElement = dom.window.HTMLElement;
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.MouseEvent = dom.window.MouseEvent;
  g.self = dom.window;
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const root = dom.window.document.getElementById("root");
  assert.ok(root);
  return root;
}

function ZoomHarness() {
  const [zoom, setZoom] = useState(SCHEDULE_ZOOM_DEFAULT);
  return (
    <div>
      <ScheduleZoomControls
        zoom={zoom}
        onZoomIn={() => setZoom((z) => stepScheduleZoom(z, 1))}
        onZoomOut={() => setZoom((z) => stepScheduleZoom(z, -1))}
        onReset={() => setZoom(SCHEDULE_ZOOM_DEFAULT)}
      />
      <ScheduleMonthTable
        data={monthData}
        readOnly
        contentZoom={zoom}
      />
    </div>
  );
}

async function main(): Promise<void> {
  const container = setupDom();
  const root = createRoot(container);

  await act(async () => {
    root.render(<ZoomHarness />);
  });

  const scroll = container.querySelector(
    '[data-testid="schedule-month-table-scroll"]',
  );
  const content = container.querySelector(
    '[data-testid="schedule-month-table-content"]',
  );
  assert.ok(scroll instanceof HTMLElement);
  assert.ok(content instanceof HTMLElement);
  assert.equal(scroll.getAttribute("data-schedule-zoom"), "1");

  const zoomIn = container.querySelector('[data-testid="schedule-zoom-in"]');
  assert.ok(zoomIn instanceof HTMLElement);
  await act(async () => {
    zoomIn.click();
  });

  assert.equal(scroll.getAttribute("data-schedule-zoom"), "1.1");
  assert.equal((content as HTMLElement).style.zoom, "1.1");
  assert.match(
    container.querySelector('[data-testid="schedule-zoom-value"]')?.textContent ??
      "",
    /110%/,
  );

  const reset = container.querySelector('[data-testid="schedule-zoom-reset"]');
  assert.ok(reset instanceof HTMLElement);
  await act(async () => {
    reset.click();
  });
  assert.equal(scroll.getAttribute("data-schedule-zoom"), "1");

  // Boundaries via controls: jump to max.
  await act(async () => {
    root.render(
      <div>
        <ScheduleZoomControls
          zoom={clampScheduleZoom(2)}
          onZoomIn={() => undefined}
          onZoomOut={() => undefined}
          onReset={() => undefined}
        />
      </div>,
    );
  });
  assert.equal(
    (
      container.querySelector(
        '[data-testid="schedule-zoom-in"]',
      ) as HTMLButtonElement
    ).disabled,
    true,
  );

  // readOnly table must not invent clickable editor open attributes on cards.
  await act(async () => {
    root.render(
      <ScheduleMonthTable data={monthData} readOnly contentZoom={1.5} />,
    );
  });
  assert.equal(
    container
      .querySelector('[data-testid="schedule-month-table-scroll"]')
      ?.getAttribute("data-schedule-zoom"),
    "1.5",
  );

  await act(async () => {
    root.unmount();
  });

  console.log("schedule-zoom-ui-check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
