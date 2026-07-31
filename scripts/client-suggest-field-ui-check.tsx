/**
 * Regression: ClientSuggestField closes after pick and stays closed
 * despite value-driven suggest refetch. Keyboard/touch contracts covered
 * in source asserts + mouse interaction in JSDOM.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  ClientSuggestField,
  type ClientSuggestItem,
} from "../src/components/schedule/client-suggest-field";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertSourceContract(): void {
  const source = read("src/components/schedule/client-suggest-field.tsx");
  assert.match(source, /suppressSuggestRef/);
  assert.match(source, /pickClient/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Enter/);
  assert.match(source, /Escape/);
  assert.match(source, /data-testid="client-suggest-list"/);
  assert.match(source, /pointerType|onClick/);
  assert.match(source, /linkedClientId/);
  assert.match(
    source,
    /suppressSuggestRef\.current = false/,
    "typing must clear suppress so search can reopen",
  );
  assert.match(
    source,
    /if \(suppressSuggestRef\.current\)/,
    "fetch effect must honor suppress after pick",
  );
  assert.match(
    source,
    /if \(linkedClientId\)[\s\S]*suppressSuggestRef\.current = true/,
    "paired name/phone field must suppress when link is set",
  );
  assert.doesNotMatch(
    source,
    /suggestEpoch/,
    "unlink must not auto-refetch current phone/name value",
  );
}

const SAMPLE_CLIENT: ClientSuggestItem = {
  id: "client-1",
  fullName: "Анна Тест",
  phone: "+79991234567",
  status: "ACTIVE",
};

function Harness({
  onPick,
}: {
  onPick: (client: ClientSuggestItem) => void;
}) {
  const [value, setValue] = useState("Ан");
  return (
    <ClientSuggestField
      mode="name"
      value={value}
      onValueChange={setValue}
      onPick={(client) => {
        onPick(client);
        setValue(client.fullName);
      }}
      inputId="client-name"
    />
  );
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function setupDom(): { container: HTMLElement; cleanup: () => void } {
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
    "HTMLButtonElement",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "PointerEvent",
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
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.MouseEvent = dom.window.MouseEvent;
  g.PointerEvent = dom.window.PointerEvent;
  g.self = dom.window;
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ ok: true, clients: [SAMPLE_CLIENT] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

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

async function assertMousePickClosesAndStaysClosed(): Promise<void> {
  let picked: ClientSuggestItem | null = null;
  const { container, cleanup } = setupDom();
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<Harness onPick={(client) => { picked = client; }} />);
    });

    await flush(350);
    const option = container.querySelector(
      '[data-testid="client-suggest-option-client-1"]',
    );
    assert.ok(option instanceof HTMLElement, "suggest option visible");

    await act(async () => {
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush(20);

    assert.equal(picked?.id, SAMPLE_CLIENT.id);
    assert.equal(
      container.querySelector('[data-testid="client-suggest-list"]'),
      null,
      "list must close after mouse pick",
    );

    await flush(400);
    assert.equal(
      container.querySelector('[data-testid="client-suggest-list"]'),
      null,
      "list must stay closed after value-driven refetch window",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

function PairedHarness({
  onPick,
}: {
  onPick: (client: ClientSuggestItem) => void;
}) {
  const [name, setName] = useState("Ан");
  const [phone, setPhone] = useState("");
  const [linkedId, setLinkedId] = useState<string | null>(null);
  return (
    <div>
      <ClientSuggestField
        mode="name"
        value={name}
        onValueChange={setName}
        linkedClientId={linkedId}
        onPick={(client) => {
          onPick(client);
          setName(client.fullName);
          setPhone(client.phone ?? "");
          setLinkedId(client.id);
        }}
        inputId="client-name"
      />
      <ClientSuggestField
        mode="phone"
        value={phone}
        onValueChange={setPhone}
        linkedClientId={linkedId}
        onPick={(client) => {
          onPick(client);
          setName(client.fullName);
          setPhone(client.phone ?? "");
          setLinkedId(client.id);
        }}
        inputId="client-phone"
      />
    </div>
  );
}

async function assertPairedPhoneFieldStaysClosedAfterNamePick(): Promise<void> {
  let picked: ClientSuggestItem | null = null;
  const { container, cleanup } = setupDom();
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <PairedHarness
          onPick={(client) => {
            picked = client;
          }}
        />,
      );
    });

    await flush(350);
    const option = container.querySelector(
      '[data-testid="client-suggest-option-client-1"]',
    );
    assert.ok(option instanceof HTMLElement, "name suggest option visible");

    await act(async () => {
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush(20);
    assert.equal(picked?.id, SAMPLE_CLIENT.id);

    await flush(400);
    assert.equal(
      container.querySelector('[data-testid="client-suggest-list"]'),
      null,
      "phone field must not reopen suggest after paired name pick",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

async function main(): Promise<void> {
  assertSourceContract();
  await assertMousePickClosesAndStaysClosed();
  await assertPairedPhoneFieldStaysClosedAfterNamePick();
  console.log("client-suggest-field-ui-check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
