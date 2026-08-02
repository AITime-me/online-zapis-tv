/**
 * Regression: ClientSuggestField must not auto-open on prefilled values;
 * fetch only after explicit focus / typing; stale responses must not reopen.
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
  assert.match(source, /focusedRef/);
  assert.match(source, /invalidateSuggest/);
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
    /if \(suppressSuggestRef\.current \|\| !focused/,
    "fetch effect must require focus and honor suppress",
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
  assert.match(
    source,
    /!focusedRef\.current/,
    "stale responses must check focus before opening",
  );
}

const SAMPLE_CLIENT: ClientSuggestItem = {
  id: "client-1",
  fullName: "Анна Тест",
  phone: "+79991234567",
  status: "ACTIVE",
};

const SAMPLE_CLIENT_B: ClientSuggestItem = {
  id: "client-2",
  fullName: "Борис Тест",
  phone: "+79997654321",
  status: "ACTIVE",
};

const PREFILLED_NAME = "Клиент Онлайн";

type FetchHandler = (input: RequestInfo | URL) => Promise<Response>;

function okResponse(clients: ClientSuggestItem[]): Response {
  return new Response(JSON.stringify({ ok: true, clients }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function setupDom(fetchImpl?: FetchHandler): {
  container: HTMLElement;
  cleanup: () => void;
  fetchCalls: string[];
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
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.MouseEvent = dom.window.MouseEvent;
  g.PointerEvent = dom.window.PointerEvent;
  g.FocusEvent = dom.window.FocusEvent;
  g.self = dom.window;
  // React focus polyfill path expects attachEvent in some JSDOM setups.
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

  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  const defaultFetch: FetchHandler = async () => okResponse([SAMPLE_CLIENT]);
  const handler = fetchImpl ?? defaultFetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return handler(input);
  }) as typeof fetch;

  const container = dom.window.document.getElementById("root");
  assert.ok(container);

  return {
    container,
    fetchCalls,
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

function focusInput(input: HTMLInputElement): void {
  try {
    input.focus();
  } catch {
    // JSDOM may throw; React onFocus still receives the event below.
  }
  input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
}

function blurInput(input: HTMLInputElement): void {
  input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  try {
    input.blur();
  } catch {
    // ignore JSDOM focus quirks
  }
}

function listbox(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="client-suggest-list"]');
}

function Harness({
  onPick,
  initialValue = "Ан",
}: {
  onPick: (client: ClientSuggestItem) => void;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
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

function PrefillHarness({
  value,
  linkedClientId = null,
  onPick,
  onBlur,
}: {
  value: string;
  linkedClientId?: string | null;
  onPick?: (client: ClientSuggestItem) => void;
  onBlur?: () => void;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [linked, setLinked] = useState(linkedClientId);
  return (
    <ClientSuggestField
      mode="name"
      value={localValue}
      linkedClientId={linked}
      onValueChange={setLocalValue}
      onBlur={onBlur}
      onPick={(client) => {
        onPick?.(client);
        setLocalValue(client.fullName);
        setLinked(client.id);
      }}
      inputId="client-name"
    />
  );
}

function EditablePrefillHarness({
  initialValue,
  onPick,
}: {
  initialValue: string;
  onPick?: (client: ClientSuggestItem) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div>
      <ClientSuggestField
        mode="name"
        value={value}
        linkedClientId={null}
        onValueChange={setValue}
        onPick={(client) => {
          onPick?.(client);
          setValue(client.fullName);
        }}
        inputId="client-name"
      />
      <button
        type="button"
        data-testid="append-char"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setValue((current) => `${current}а`)}
      >
        append
      </button>
    </div>
  );
}

function ValueSwitchHarness({
  value,
  onPick,
}: {
  value: string;
  onPick?: (client: ClientSuggestItem) => void;
}) {
  return (
    <ClientSuggestField
      mode="name"
      value={value}
      linkedClientId={null}
      onValueChange={() => undefined}
      onPick={(client) => {
        onPick?.(client);
      }}
      inputId="client-name"
    />
  );
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
      <button
        type="button"
        data-testid="unlink"
        onClick={() => setLinkedId(null)}
      >
        unlink
      </button>
    </div>
  );
}

/** A. Prefilled unlinked value must not fetch or open. */
async function assertInitialPopulatedDoesNotFetch(): Promise<void> {
  const { container, cleanup, fetchCalls } = setupDom();
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <PrefillHarness value={PREFILLED_NAME} linkedClientId={null} />,
      );
    });
    await flush(400);
    assert.equal(fetchCalls.length, 0, "A: no automatic suggest fetch");
    assert.equal(listbox(container), null, "A: listbox absent on open");
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

/** B. Explicit focus triggers fetch and opens list. */
async function assertExplicitFocusFetches(): Promise<void> {
  const { container, cleanup, fetchCalls } = setupDom();
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <PrefillHarness value={PREFILLED_NAME} linkedClientId={null} />,
      );
    });
    await flush(50);
    assert.equal(fetchCalls.length, 0);

    const input = container.querySelector("#client-name");
    assert.ok(input instanceof HTMLInputElement);
    await act(async () => {
      focusInput(input);
    });
    await flush(350);

    assert.ok(fetchCalls.length >= 1, "B: focus triggers fetch");
    assert.ok(listbox(container), "B: listbox appears after focus fetch");
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

/** C. Blur + late response must not open list. */
async function assertBlurDropsLateResponse(): Promise<void> {
  let resolveFetch!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  const { container, cleanup, fetchCalls } = setupDom(async () => pending);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <PrefillHarness value={PREFILLED_NAME} linkedClientId={null} />,
      );
    });
    const input = container.querySelector("#client-name");
    assert.ok(input instanceof HTMLInputElement);
    await act(async () => {
      focusInput(input);
    });
    await flush(350);
    assert.ok(fetchCalls.length >= 1, "C: fetch started while focused");

    await act(async () => {
      blurInput(input);
    });
    await flush(20);
    assert.equal(listbox(container), null, "C: closed on blur");

    await act(async () => {
      resolveFetch(okResponse([SAMPLE_CLIENT]));
      await pending;
    });
    await flush(50);
    assert.equal(listbox(container), null, "C: late response must not open");
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

/** D. Escape closes; value preserved; late response must not reopen. */
async function assertEscapeClosesAndBlocksStale(): Promise<void> {
  let resolveLate!: (response: Response) => void;
  let fetchCount = 0;
  const { container, cleanup } = setupDom(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return okResponse([SAMPLE_CLIENT]);
    }
    return new Promise<Response>((resolve) => {
      resolveLate = resolve;
    });
  });
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<EditablePrefillHarness initialValue={PREFILLED_NAME} />);
    });
    const input = container.querySelector("#client-name");
    assert.ok(input instanceof HTMLInputElement);
    await act(async () => {
      focusInput(input);
    });
    await flush(350);
    assert.ok(listbox(container), "D: list open before Escape");

    const append = container.querySelector('[data-testid="append-char"]');
    assert.ok(append instanceof HTMLElement);
    await act(async () => {
      append.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush(350);
    assert.ok(fetchCount >= 2, "D: second fetch started");
    assert.equal(
      input.value,
      `${PREFILLED_NAME}а`,
      "D: value updated before Escape",
    );

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush(20);
    assert.equal(listbox(container), null, "D: list closed after Escape");
    assert.equal(
      input.value,
      `${PREFILLED_NAME}а`,
      "D: value unchanged after Escape",
    );

    await act(async () => {
      resolveLate(okResponse([SAMPLE_CLIENT_B]));
    });
    await flush(50);
    assert.equal(listbox(container), null, "D: late response must not reopen");
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

/** E. Pick closes once; value update does not reopen. */
async function assertMousePickClosesAndStaysClosed(): Promise<void> {
  let picked: ClientSuggestItem | null = null;
  let pickCount = 0;
  const { container, cleanup } = setupDom();
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <Harness
          onPick={(client) => {
            picked = client;
            pickCount += 1;
          }}
        />,
      );
    });

    const input = container.querySelector("#client-name");
    assert.ok(input instanceof HTMLInputElement);
    await act(async () => {
      focusInput(input);
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
    assert.equal(pickCount, 1, "E: onPick once");
    assert.equal(
      listbox(container),
      null,
      "E: list must close after mouse pick",
    );

    await flush(400);
    assert.equal(
      listbox(container),
      null,
      "E: list must stay closed after value-driven refetch window",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

/** F. linkedClientId set/clear must not auto-open; focus after unlink works. */
async function assertLinkedClientIdChange(): Promise<void> {
  const { container, cleanup, fetchCalls } = setupDom();
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<PairedHarness onPick={() => undefined} />);
    });

    const nameInput = container.querySelector("#client-name");
    assert.ok(nameInput instanceof HTMLInputElement);
    await act(async () => {
      focusInput(nameInput);
    });
    await flush(350);
    const option = container.querySelector(
      '[data-testid="client-suggest-option-client-1"]',
    );
    assert.ok(option instanceof HTMLElement);

    await act(async () => {
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush(400);
    assert.equal(listbox(container), null, "F: closed after link");

    const unlink = container.querySelector('[data-testid="unlink"]');
    assert.ok(unlink instanceof HTMLElement);
    const fetchesBeforeUnlink = fetchCalls.length;
    await act(async () => {
      blurInput(nameInput);
      unlink.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush(400);
    assert.equal(listbox(container), null, "F: unlink must not auto-open");
    assert.equal(
      fetchCalls.length,
      fetchesBeforeUnlink,
      "F: unlink must not fetch",
    );

    await act(async () => {
      focusInput(nameInput);
    });
    await flush(350);
    assert.ok(fetchCalls.length > fetchesBeforeUnlink, "F: focus after unlink");
    assert.ok(listbox(container), "F: list available after focus");
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

/** G. Appointment/value switch invalidates prior fetch; no auto-fetch. */
async function assertValueSwitchDropsStale(): Promise<void> {
  let resolveFirst!: (response: Response) => void;
  let fetchCount = 0;
  const { container, cleanup, fetchCalls } = setupDom(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
    }
    return okResponse([SAMPLE_CLIENT_B]);
  });
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<ValueSwitchHarness value="Первая Запись" />);
    });
    const input = container.querySelector("#client-name");
    assert.ok(input instanceof HTMLInputElement);
    await act(async () => {
      focusInput(input);
    });
    await flush(350);
    assert.equal(fetchCalls.length, 1, "G: first fetch started");

    await act(async () => {
      blurInput(input);
    });
    await act(async () => {
      root.render(<ValueSwitchHarness value="Вторая Запись" />);
    });
    await flush(400);
    assert.equal(
      fetchCalls.length,
      1,
      "G: prefilled second value must not auto-fetch",
    );
    assert.equal(listbox(container), null);

    await act(async () => {
      resolveFirst(okResponse([SAMPLE_CLIENT]));
    });
    await flush(50);
    assert.equal(
      listbox(container),
      null,
      "G: stale first response must not open for second appointment",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
}

/** H. Keyboard navigation preserved. */
async function assertKeyboardNavigation(): Promise<void> {
  let picked: ClientSuggestItem | null = null;
  const clients = [SAMPLE_CLIENT, SAMPLE_CLIENT_B];
  const { container, cleanup } = setupDom(async () => okResponse(clients));
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <Harness
          onPick={(client) => {
            picked = client;
          }}
        />,
      );
    });
    const input = container.querySelector("#client-name");
    assert.ok(input instanceof HTMLInputElement);
    await act(async () => {
      focusInput(input);
    });
    await flush(350);
    assert.ok(listbox(container), "H: list open for keyboard nav");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush(20);
    assert.equal(listbox(container), null, "H: Escape closes");
    assert.equal(input.value, "Ан", "H: Escape keeps value");

    await act(async () => {
      blurInput(input);
    });
    await act(async () => {
      focusInput(input);
    });
    await flush(350);
    assert.ok(listbox(container), "H: list reopens after blur+focus");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush(20);
    assert.equal(picked?.id, SAMPLE_CLIENT.id, "H: Enter picks highlighted");
    assert.equal(listbox(container), null, "H: Enter closes list");
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
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

    const nameInput = container.querySelector("#client-name");
    assert.ok(nameInput instanceof HTMLInputElement);
    await act(async () => {
      focusInput(nameInput);
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
      listbox(container),
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
  await assertInitialPopulatedDoesNotFetch();
  await assertExplicitFocusFetches();
  await assertBlurDropsLateResponse();
  await assertEscapeClosesAndBlocksStale();
  await assertMousePickClosesAndStaysClosed();
  await assertLinkedClientIdChange();
  await assertValueSwitchDropsStale();
  await assertKeyboardNavigation();
  await assertPairedPhoneFieldStaysClosedAfterNamePick();
  console.log("client-suggest-field-ui-check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
