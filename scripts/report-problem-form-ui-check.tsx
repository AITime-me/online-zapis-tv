/**
 * Regression: report-problem modal must not steal focus on pending,
 * must block double-submit, and must restore trigger focus on close.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { ReportProblemEntry } from "../src/components/booking/report-problem-form";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertSourceContract(): void {
  const source = read("src/components/booking/report-problem-form.tsx");
  assert.match(source, /pendingRef/);
  assert.match(source, /onCloseRef/);
  assert.match(source, /submitLockRef/);
  assert.doesNotMatch(source, /}, \[onClose, pending\]\)/);
  assert.match(
    source,
    /document\.body\.style\.overflow = "hidden";[\s\S]*\}, \[\]\);/,
  );
  assert.match(
    source,
    /document\.addEventListener\("keydown", onKeyDown\);[\s\S]*\}, \[\]\);/,
  );
  assert.match(source, /if \(closeButton && !closeButton\.disabled\)/);
  assert.match(source, /if \(pendingRef\.current\)/);
}

function setupDom(): {
  container: HTMLElement;
  cleanup: () => void;
} {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/booking" },
  );
  const g = globalThis as unknown as Record<string, unknown>;
  const previous: Record<string, unknown> = {};
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLTextAreaElement",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
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
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.MouseEvent = dom.window.MouseEvent;
  g.self = dom.window;
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  // React 19 + JSDOM: attachEvent polyfill stub used by input event path.
  const proto = dom.window.HTMLElement.prototype as unknown as {
    attachEvent?: unknown;
    detachEvent?: unknown;
  };
  if (typeof proto.attachEvent !== "function") {
    proto.attachEvent = () => false;
    proto.detachEvent = () => false;
  }

  const container = dom.window.document.getElementById("root");
  assert.ok(container);

  return {
    container,
    cleanup: () => {
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

async function assertPendingDoesNotStealFocus(): Promise<void> {
  const { container, cleanup } = setupDom();
  const root = createRoot(container);
  const doc = container.ownerDocument;
  assert.ok(doc);

  let release!: (value: Response) => void;
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return gate;
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(<ReportProblemEntry />);
    });

    const openButton = Array.from(doc.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Сообщить о проблеме"),
    );
    assert.ok(openButton instanceof doc.defaultView!.HTMLButtonElement);
    await act(async () => {
      openButton.click();
    });
    await flush(20);

    const dialog = doc.querySelector('[data-testid="report-problem-dialog"]');
    assert.ok(dialog);

    const closeButton = dialog.querySelector(
      'button[aria-label="Закрыть"]',
    ) as HTMLButtonElement | null;
    assert.ok(closeButton);
    assert.equal(doc.activeElement, closeButton, "initial focus on close");

    const submit = dialog.querySelector(
      '[data-testid="report-problem-submit"]',
    ) as HTMLButtonElement;
    assert.ok(submit);

    await act(async () => {
      submit.focus();
    });
    assert.equal(doc.activeElement, submit);

    await act(async () => {
      submit.click();
    });
    await flush(20);

    assert.equal(fetchCalls, 1, "first submit starts request");
    assert.equal(submit.disabled, true);
    assert.match(submit.textContent ?? "", /Отправка/);
    assert.equal(closeButton.disabled, true);
    assert.notEqual(
      doc.activeElement,
      closeButton,
      "pending must not move focus to close button",
    );

    await act(async () => {
      submit.click();
    });
    await flush(10);
    assert.equal(fetchCalls, 1, "second submit blocked while pending");

    await act(async () => {
      doc.dispatchEvent(
        new doc.defaultView!.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    assert.ok(
      doc.querySelector('[data-testid="report-problem-dialog"]'),
      "Escape during pending must not close",
    );

    await act(async () => {
      release(
        new Response(
          JSON.stringify({
            ok: true,
            id: "ui-test",
            message: "Спасибо! Сообщение отправлено. Мы свяжемся с вами.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    await flush(30);

    const successClose = Array.from(
      doc.querySelectorAll('[data-testid="report-problem-success"] button'),
    ).find((btn) => btn.textContent?.includes("Закрыть"));
    assert.ok(successClose instanceof doc.defaultView!.HTMLButtonElement);

    await act(async () => {
      successClose.click();
    });
    await flush(20);

    assert.equal(doc.querySelector('[data-testid="report-problem-dialog"]'), null);
    assert.equal(
      doc.activeElement,
      openButton,
      "focus returns to trigger after close",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

async function main(): Promise<void> {
  assertSourceContract();
  await assertPendingDoesNotStealFocus();
  console.log("report-problem-form-ui-check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
