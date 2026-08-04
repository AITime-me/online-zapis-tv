/**
 * Stage 1 presentation checks for src/components/game/wheel-ui.
 * Pattern matches other *-ui-check.tsx scripts (JSDOM + React createRoot).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  BRAND,
  WHEEL_SECTOR_COUNT,
  WheelCopySendActions,
  WheelFortuneView,
  WheelPreferenceStep,
  canContinuePreferences,
  computeRotationForSector,
  prefersReducedMotion,
  type WheelFortuneViewProps,
  type WheelSector,
} from "../src/components/game/wheel-ui";

const ROOT = path.resolve(__dirname, "..");
const WHEEL_UI_DIR = path.join(ROOT, "src/components/game/wheel-ui");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function listWheelUiFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  walk(WHEEL_UI_DIR);
  return out;
}

const SAMPLE_SECTORS: WheelSector[] = Array.from(
  { length: WHEEL_SECTOR_COUNT },
  (_, i) => ({
    id: `s${String(i + 1).padStart(2, "0")}`,
    shortLabel: `S${i + 1}`,
    fullName: `Полное название приза ${i + 1}`,
  }),
);

function noop() {}

function baseProps(
  overrides: Partial<WheelFortuneViewProps> = {},
): WheelFortuneViewProps {
  return {
    title: BRAND.gameTitle,
    subtitle: BRAND.gameSubtitle,
    phase: "intro",
    sectors: SAMPLE_SECTORS,
    selectedIntent: null,
    selectedZone: null,
    lead: {
      name: "",
      phone: "",
      personalDataConsent: false,
      offerAcknowledgement: false,
    },
    result: null,
    rotationDeg: 0,
    busy: false,
    error: null,
    onStart: noop,
    onIntentChange: noop,
    onZoneChange: noop,
    onLeadChange: noop,
    onPreferencesContinue: noop,
    onContactContinue: noop,
    onSpin: noop,
    onClaim: noop,
    onBack: noop,
    onReset: noop,
    ...overrides,
  };
}

function setupDom(): { container: HTMLElement; cleanup: () => void } {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/promo/wheel" },
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
    "HTMLCanvasElement",
    "Node",
    "Event",
    "MouseEvent",
    "self",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "ResizeObserver",
    "matchMedia",
  ]) {
    previous[key] = g[key];
  }

  g.window = dom.window;
  g.document = dom.window.document;
  g.navigator = dom.window.navigator;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.MouseEvent = dom.window.MouseEvent;
  g.self = dom.window;
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.matchMedia = (query: string) => ({
    matches: String(query).includes("prefers-reduced-motion: reduce")
      ? Boolean((dom.window as unknown as { __reduced?: boolean }).__reduced)
      : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
    onchange: null,
  });
  dom.window.matchMedia = g.matchMedia as typeof dom.window.matchMedia;

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const canvasProto = dom.window.HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => unknown;
  };
  canvasProto.getContext = () => ({
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    moveTo() {},
    bezierCurveTo() {},
    fill() {},
    arc() {},
    fillRect() {},
    fillStyle: "",
    globalAlpha: 1,
  });

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

function assertSourceContracts(): void {
  const files = listWheelUiFiles();
  assert.ok(files.length > 0, "wheel-ui directory must not be empty");

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");

    assert.doesNotMatch(
      source,
      /\bfetch\s*\(/,
      `${rel} must not call fetch`,
    );
    assert.doesNotMatch(
      source,
      /localStorage|sessionStorage/,
      `${rel} must not touch web storage`,
    );
    assert.doesNotMatch(
      source,
      /from\s+["'].*mock|DemoWheelController|PreviewToolbar|demo-phone|mock-prizes|mock-scenarios|mock-wheel-controller/,
      `${rel} must not import mock/demo modules`,
    );
    assert.doesNotMatch(
      source,
      /@\/services\/|prisma|WheelPublicGameService/,
      `${rel} must stay presentation-only`,
    );
  }

  const share = read("src/components/game/wheel-ui/wheel-ui.share.ts");
  assert.doesNotMatch(
    share,
    /DEFAULT_VK_URL|DEFAULT_MAX_URL|vk\.me|web\.max\.ru/,
    "share helpers must not hardcode production messenger URLs",
  );

  const css = read("src/components/game/wheel-ui/wheel-ui.css");
  assert.doesNotMatch(
    css,
    /(^|[^.\w-])(body|html)\s*\{/,
    "wheel-ui.css must not style global body/html",
  );
  const layout = read("src/components/game/wheel-ui/wheel-layout.tsx");
  assert.match(layout, /import\s+["']\.\/wheel-ui\.css["']/);

  const restored = read("src/components/game/wheel-ui/wheel-restored-step.tsx");
  assert.match(
    restored,
    /claimStatus\s*=\s*null/,
    "restored claimStatus must default to null, not submitted",
  );
  assert.doesNotMatch(
    restored,
    /claimStatus\s*=\s*["']submitted["']/,
    "restored must not default claimStatus to submitted",
  );

  const contact = read("src/components/game/wheel-ui/wheel-contact-step.tsx");
  assert.match(contact, /phoneSlot/);
  assert.match(contact, /consentSlot/);
  assert.match(contact, /contactContext/);
  assert.match(contact, /restored-pending/);
  assert.doesNotMatch(
    contact,
    /hint=["'][^"']*PhoneCountrySelect|В production сюда подключается/,
    "contact fallback must not expose PhoneCountrySelect wiring hint",
  );
}

async function renderView(
  container: HTMLElement,
  props: WheelFortuneViewProps,
): Promise<{ unmount: () => void }> {
  const root = createRoot(container);
  await act(async () => {
    root.render(<WheelFortuneView {...props} />);
  });
  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

async function runUiChecks(): Promise<void> {
  const { container, cleanup } = setupDom();
  try {
    // 1–3: 16 sectors, shortLabel, hub without prize full name
    {
      const prizeFull = "Секретный длинный подарок XYZ";
      const { unmount } = await renderView(
        container,
        baseProps({
          phase: "ready",
          sectors: SAMPLE_SECTORS.map((s, i) =>
            i === 0 ? { ...s, shortLabel: "Шорт", fullName: prizeFull } : s,
          ),
          result: {
            sectorId: "s01",
            fullName: prizeFull,
          },
        }),
      );

      const disc = container.querySelector('[data-testid="wheel-disc"]');
      assert.ok(disc);
      const tspans = Array.from(disc!.querySelectorAll("tspan")).map(
        (el) => el.textContent ?? "",
      );
      assert.equal(
        tspans.filter((t) => t.trim().length > 0).length,
        WHEEL_SECTOR_COUNT,
        "expected 16 shortLabel tspans",
      );
      assert.ok(tspans.some((t) => t.includes("Шорт")));
      assert.ok(!tspans.some((t) => t.includes(prizeFull)));

      const hub = container.querySelector('[data-testid="wheel-hub"]');
      assert.ok(hub);
      assert.doesNotMatch(hub!.textContent ?? "", /Секретный длинный подарок/);
      assert.equal(container.querySelector('[data-testid="result-card"]'), null);
      unmount();
      container.innerHTML = "";
    }

    // 4–6: intent/zone toggle + disabled continue
    {
      let intent: "primary" | null = "primary";
      let zone: "lips" | null = "lips";

      function PreferenceHarness() {
        const [selectedIntent, setIntent] = useState(intent);
        const [selectedZone, setZone] = useState(zone);
        return (
          <WheelPreferenceStep
            title={BRAND.gameTitle}
            selectedIntent={selectedIntent}
            selectedZone={selectedZone}
            onIntentChange={(value) => {
              intent = value as typeof intent;
              setIntent(value);
            }}
            onZoneChange={(value) => {
              zone = value as typeof zone;
              setZone(value);
            }}
            onContinue={noop}
            onBack={noop}
          />
        );
      }

      const root = createRoot(container);
      await act(async () => {
        root.render(<PreferenceHarness />);
      });

      const continueBtn = container.querySelector(
        '[data-testid="preferences-continue"]',
      ) as HTMLButtonElement | null;
      assert.ok(continueBtn);
      assert.equal(continueBtn!.disabled, false);

      const intentBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Первый перманент"),
      ) as HTMLButtonElement;
      assert.equal(intentBtn.getAttribute("aria-pressed"), "true");

      await act(async () => {
        intentBtn.click();
      });
      assert.equal(intent, null);
      assert.equal(
        (
          container.querySelector(
            '[data-testid="preferences-continue"]',
          ) as HTMLButtonElement
        ).disabled,
        true,
      );

      assert.equal(canContinuePreferences(null, null), false);
      assert.equal(canContinuePreferences("primary", null), false);
      assert.equal(canContinuePreferences("primary", "lips"), true);
      assert.equal(canContinuePreferences("undecided", null), true);

      await act(async () => {
        root.render(
          <WheelPreferenceStep
            title={BRAND.gameTitle}
            selectedIntent="undecided"
            selectedZone={null}
            onIntentChange={noop}
            onZoneChange={noop}
            onContinue={noop}
            onBack={noop}
          />,
        );
      });
      const zoneWhenUndecided = Array.from(
        container.querySelectorAll("button"),
      ).find((b) => b.textContent?.trim() === "Губы") as HTMLButtonElement;
      assert.ok(zoneWhenUndecided);
      assert.equal(
        zoneWhenUndecided.disabled,
        true,
        "zone choices must be disabled for undecided",
      );

      await act(async () => {
        root.render(
          <WheelPreferenceStep
            title={BRAND.gameTitle}
            selectedIntent="primary"
            selectedZone="lips"
            onIntentChange={noop}
            onZoneChange={(value) => {
              zone = value as typeof zone;
            }}
            onContinue={noop}
            onBack={noop}
          />,
        );
      });
      const zoneBtnAfter = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Губы",
      ) as HTMLButtonElement;
      await act(async () => {
        zoneBtnAfter.click();
      });
      assert.equal(zone, null);

      act(() => root.unmount());
      container.innerHTML = "";
    }

    // 7–8: confetti only on fresh result
    {
      const { unmount } = await renderView(
        container,
        baseProps({
          phase: "result",
          result: {
            sectorId: "s01",
            fullName: "Подарок A",
          },
          selectedIntent: "primary",
          selectedZone: "lips",
        }),
      );
      const canvas = container.querySelector(
        '[data-testid="wheel-confetti-canvas"]',
      ) as HTMLElement | null;
      assert.ok(canvas, "result must mount confetti canvas");
      unmount();
      container.innerHTML = "";

      const restored = await renderView(
        container,
        baseProps({
          phase: "restored",
          claimStatus: "pending",
          result: { sectorId: "s01", fullName: "Подарок A" },
        }),
      );
      assert.equal(
        container.querySelector('[data-testid="wheel-confetti-canvas"]'),
        null,
      );
      assert.ok(container.querySelector('[data-testid="restored-card"]'));
      restored.unmount();
      container.innerHTML = "";

      const submitted = await renderView(
        container,
        baseProps({
          phase: "submitted",
          result: { sectorId: "s01", fullName: "Подарок A" },
          vkUrl: "https://example.test/vk",
          maxUrl: "https://example.test/max",
        }),
      );
      assert.equal(
        container.querySelector('[data-testid="wheel-confetti-canvas"]'),
        null,
      );
      submitted.unmount();
      container.innerHTML = "";
    }

    // 9: share actions receive URLs via props
    {
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <div className="wheel-ui-root">
            <WheelCopySendActions
              messageText="hello"
              vkUrl="https://example.test/vk"
              maxUrl="https://example.test/max"
            />
          </div>,
        );
      });
      const vk = container.querySelector(
        '[data-testid="copy-open-vk"]',
      ) as HTMLButtonElement;
      const max = container.querySelector(
        '[data-testid="copy-open-max"]',
      ) as HTMLButtonElement;
      assert.ok(vk);
      assert.ok(max);
      act(() => root.unmount());
      container.innerHTML = "";

      const root2 = createRoot(container);
      await act(async () => {
        root2.render(
          <div className="wheel-ui-root">
            <WheelCopySendActions messageText="hello" />
          </div>,
        );
      });
      assert.equal(
        container.querySelector('[data-testid="wheel-copy-send-actions"]'),
        null,
        "without URLs share actions must not render",
      );
      act(() => root2.unmount());
      container.innerHTML = "";
    }

    // 12: reduced-motion helper consults matchMedia
    {
      (window as unknown as { __reduced?: boolean }).__reduced = true;
      assert.equal(prefersReducedMotion(), true);
      (window as unknown as { __reduced?: boolean }).__reduced = false;
      assert.equal(prefersReducedMotion(), false);
    }

    // rotation helper sanity
    {
      const deg = computeRotationForSector("s01", SAMPLE_SECTORS, 0, 4);
      assert.ok(deg >= 360 * 4);
    }
  } finally {
    cleanup();
  }
}

async function main(): Promise<void> {
  assertSourceContracts();
  await runUiChecks();
  console.log("wheel-ui presentation checks: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
