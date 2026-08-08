/**
 * Regression: Quick Day Editor appointment draft must survive same-id prop refresh.
 *
 * Root cause under test:
 * updateField → debounced PATCH → refreshCell → new appointment object reference →
 * useEffect([appointment]) setForm(toFormState(appointment)) wiped dirty draft,
 * broke caret/IME, and made the modal jump while typing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import React, { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppointmentEditorForm } from "../src/components/schedule/appointment-editor-form";
import type { EditorOptions } from "../src/lib/schedule/editor-options";
import type { ScheduleAppointmentOperationalFields } from "../src/lib/schedule/appointment-contract";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function assertSourceContract(): void {
  const appointmentEditor = stripComments(
    read("src/components/schedule/appointment-editor-form.tsx"),
  );
  const blockEditor = stripComments(
    read("src/components/schedule/schedule-block-editor-form.tsx"),
  );
  const quickDay = stripComments(
    read("src/components/schedule/quick-day-editor.tsx"),
  );

  assert.match(
    appointmentEditor,
    /if \(appointmentIdRef\.current === appointment\.id\) \{\s*return;/,
    "AppointmentEditorForm must ignore same-id appointment prop refresh",
  );
  assert.doesNotMatch(
    appointmentEditor,
    /useEffect\(\(\) => \{\s*setForm\(toFormState\(appointment\)\);\s*setShowOverlapConfirm/,
    "must not unconditionally reset form from appointment props",
  );

  assert.match(
    blockEditor,
    /if \(blockIdRef\.current === block\.id\) \{\s*return;/,
    "ScheduleBlockEditorForm must ignore same-id block prop refresh",
  );

  assert.match(
    quickDay,
    /onSaved=\{async \(\) => \{\s*await refreshCell\(\);/,
    "autosave still refreshes cell after successful save",
  );
  assert.match(
    quickDay,
    /min-h-\[1rem\]/,
    "save status line should reserve height to avoid header jump",
  );
}

type DraftState = {
  importantNote: string;
};

function toDraft(appointment: ScheduleAppointmentOperationalFields): DraftState {
  return {
    importantNote: appointment.importantNote ?? "",
  };
}

/**
 * Minimal reproduction of AppointmentEditorForm draft sync used before/after the fix.
 * `guardSameId` mirrors the production early-return on same appointment.id.
 */
function DraftSyncProbe({
  appointment,
  guardSameId,
}: {
  appointment: ScheduleAppointmentOperationalFields;
  guardSameId: boolean;
}) {
  const [draft, setDraft] = useState(() => toDraft(appointment));
  const appointmentIdRef = useRef(appointment.id);

  useEffect(() => {
    if (guardSameId && appointmentIdRef.current === appointment.id) {
      return;
    }
    appointmentIdRef.current = appointment.id;
    setDraft(toDraft(appointment));
  }, [appointment, guardSameId]);

  return (
    <div>
      <textarea
        data-testid="important-note"
        value={draft.importantNote}
        onChange={(event) =>
          setDraft({ importantNote: event.target.value })
        }
      />
      <button
        type="button"
        data-testid="type-more"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          setDraft((current) => ({
            importantNote: `${current.importantNote} ещё`,
          }))
        }
      >
        type
      </button>
      <span data-testid="draft-value">{draft.importantNote}</span>
    </div>
  );
}

function makeAppointment(
  overrides: Partial<ScheduleAppointmentOperationalFields> = {},
): ScheduleAppointmentOperationalFields {
  return {
    id: "appt-1",
    serviceId: "svc-1",
    startsAt: "2026-07-03T06:00:00.000Z",
    endsAt: "2026-07-03T07:00:00.000Z",
    clientName: "Клиент Тест",
    serviceName: "Услуга",
    isBold: false,
    isManualTimeOverride: false,
    status: "CONFIRMED",
    source: "INTERNAL",
    statusCode: "CONFIRMED",
    sourceCode: "INTERNAL",
    clientPhone: "+79990001122",
    comment: "внутренний",
    importantNote: "старая пометка",
    appliedPromotions: [],
    clientId: null,
    ...overrides,
  };
}

const OPTIONS: EditorOptions = {
  master: { workStart: "09:00", workEnd: "21:00" },
  services: [
    {
      id: "svc-1",
      publicName: "Услуга",
      durationMinutes: 60,
      breakAfterMinutes: 0,
      totalBusyMinutes: 60,
      priceFrom: null,
      priceTo: null,
    },
  ],
  statuses: [{ value: "CONFIRMED", label: "Подтверждена" }],
  sources: [{ value: "INTERNAL", label: "Внутренняя" }],
};

function setupDom(): {
  container: HTMLElement;
  cleanup: () => void;
} {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/" },
  );
  const g = globalThis as unknown as Record<string, unknown>;
  const previous: Record<string, unknown> = {};
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLButtonElement",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "PointerEvent",
    "FocusEvent",
    "self",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    previous[key] = g[key];
  }

  g.window = dom.window;
  g.document = dom.window.document;
  g.navigator = dom.window.navigator;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.MouseEvent = dom.window.MouseEvent;
  g.PointerEvent = dom.window.PointerEvent;
  g.FocusEvent = dom.window.FocusEvent;
  g.self = dom.window;
  const htmlProto = dom.window.HTMLElement.prototype as HTMLElement & {
    attachEvent?: (...args: unknown[]) => void;
    detachEvent?: (...args: unknown[]) => void;
  };
  if (typeof htmlProto.attachEvent !== "function") {
    htmlProto.attachEvent = () => undefined;
    htmlProto.detachEvent = () => undefined;
  }
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  const container = dom.window.document.getElementById("root");
  assert.ok(container);

  return {
    container,
    cleanup: () => {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete g[key];
        else g[key] = value;
      }
      dom.window.close();
    },
  };
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function runProbeShowsBugWithoutGuard(): Promise<void> {
  const { container, cleanup } = setupDom();
  let root: Root | null = null;
  try {
    function Harness() {
      const [appointment, setAppointment] = useState(
        makeAppointment({ importantNote: "база" }),
      );
      return (
        <div>
          <DraftSyncProbe appointment={appointment} guardSameId={false} />
          <button
            type="button"
            data-testid="refresh"
            onClick={() =>
              setAppointment(makeAppointment({ importantNote: "база" }))
            }
          >
            refresh
          </button>
        </div>
      );
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(<Harness />);
    });
    await flush();

    const typeButton = container.querySelector(
      '[data-testid="type-more"]',
    ) as HTMLButtonElement;
    const textarea = container.querySelector(
      '[data-testid="important-note"]',
    ) as HTMLTextAreaElement;
    assert.ok(typeButton);
    assert.ok(textarea);
    const nodeBefore = textarea;

    await act(async () => {
      typeButton.click();
    });
    await flush();
    assert.equal(textarea.value, "база ещё");

    await act(async () => {
      (
        container.querySelector('[data-testid="refresh"]') as HTMLButtonElement
      ).click();
    });
    await flush();

    const after = container.querySelector(
      '[data-testid="important-note"]',
    ) as HTMLTextAreaElement;
    assert.equal(after, nodeBefore, "DOM node identity stays (no remount)");
    assert.equal(
      after.value,
      "база",
      "without guard, same-id refresh overwrites dirty draft (bug repro)",
    );
  } finally {
    await act(async () => {
      root?.unmount();
    });
    cleanup();
  }
}

async function runProbeKeepsDraftWithGuard(): Promise<void> {
  const { container, cleanup } = setupDom();
  let root: Root | null = null;
  try {
    function Harness() {
      const [appointment, setAppointment] = useState(
        makeAppointment({ importantNote: "база" }),
      );
      return (
        <div>
          <DraftSyncProbe appointment={appointment} guardSameId />
          <button
            type="button"
            data-testid="refresh"
            onClick={() =>
              setAppointment(
                makeAppointment({
                  importantNote: "база",
                  comment: "сервер обновил другое поле",
                }),
              )
            }
          >
            refresh
          </button>
        </div>
      );
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(<Harness />);
    });
    await flush();

    const typeButton = container.querySelector(
      '[data-testid="type-more"]',
    ) as HTMLButtonElement;
    const textarea = container.querySelector(
      '[data-testid="important-note"]',
    ) as HTMLTextAreaElement;
    const nodeBefore = textarea;

    await act(async () => {
      typeButton.click();
      typeButton.click();
    });
    await flush();
    assert.equal(textarea.value, "база ещё ещё");

    await act(async () => {
      (
        container.querySelector('[data-testid="refresh"]') as HTMLButtonElement
      ).click();
    });
    await flush();

    const after = container.querySelector(
      '[data-testid="important-note"]',
    ) as HTMLTextAreaElement;
    assert.equal(after, nodeBefore, "textarea keeps DOM identity");
    assert.equal(
      after.value,
      "база ещё ещё",
      "with guard, dirty draft survives same-id background refresh",
    );
    assert.equal(
      container.querySelector('[data-testid="draft-value"]')?.textContent,
      "база ещё ещё",
    );
  } finally {
    await act(async () => {
      root?.unmount();
    });
    cleanup();
  }
}

async function runRealEditorKeepsSnapshotAcrossPropRefresh(): Promise<void> {
  const { container, cleanup } = setupDom();
  let root: Root | null = null;
  try {
    function Parent() {
      const [appointment, setAppointment] = useState(
        makeAppointment({ importantNote: "снимок при открытии" }),
      );
      return (
        <div>
          <AppointmentEditorForm
            appointment={appointment}
            dateKey="2026-07-03"
            masterId="master-1"
            masterName="Мастер"
            options={OPTIONS}
            canEdit
            onSaved={() => undefined}
            onCancelled={() => undefined}
            onSaveStatus={() => undefined}
          />
          <button
            type="button"
            data-testid="simulate-cell-refresh"
            onClick={() =>
              setAppointment(
                makeAppointment({
                  importantNote: "значение с сервера после refreshCell",
                  comment: "после refreshCell",
                }),
              )
            }
          >
            refresh
          </button>
        </div>
      );
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(<Parent />);
    });
    await flush(20);

    const textarea = container.querySelector(
      "#appointment-appt-1-importantNote",
    ) as HTMLTextAreaElement | null;
    assert.ok(textarea, "real AppointmentEditorForm importantNote field");
    const nodeBefore = textarea;
    assert.equal(textarea.value, "снимок при открытии");

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-cell-refresh"]',
        ) as HTMLButtonElement
      ).click();
    });
    await flush(20);

    const after = container.querySelector(
      "#appointment-appt-1-importantNote",
    ) as HTMLTextAreaElement | null;
    assert.ok(after);
    assert.equal(after, nodeBefore, "real editor textarea keeps identity");
    assert.equal(
      after.value,
      "снимок при открытии",
      "real AppointmentEditorForm must not reinitialize draft from same-id refreshCell props",
    );
    assert.notEqual(
      after.value,
      "значение с сервера после refreshCell",
      "server snapshot must not silently replace the open editor draft",
    );
  } finally {
    await act(async () => {
      root?.unmount();
    });
    cleanup();
  }
}

async function main(): Promise<void> {
  assertSourceContract();
  await runProbeShowsBugWithoutGuard();
  await runProbeKeepsDraftWithGuard();
  await runRealEditorKeepsSnapshotAcrossPropRefresh();
  console.log("quick-day-editor-draft-stability-ui-check: passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
