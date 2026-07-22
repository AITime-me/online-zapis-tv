/**
 * Регрессия: QuickDayEditor desktop drag — panel transform, gates, bounds, a11y.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function main(): void {
  const editor = stripComments(read("src/components/schedule/quick-day-editor.tsx"));
  const form = stripComments(
    read("src/components/schedule/appointment-editor-form.tsx"),
  );

  assert.match(
    editor,
    /DESKTOP_DRAG_MEDIA\s*=\s*"\(min-width:\s*768px\)\s*and\s*\(pointer:\s*fine\)"/,
  );
  assert.match(editor, /matchMedia\(DESKTOP_DRAG_MEDIA\)/);
  assert.match(editor, /clampPanelOffset/);
  assert.match(editor, /VIEWPORT_MARGIN_PX/);
  assert.match(editor, /DRAG_THRESHOLD_PX/);
  assert.match(editor, /setPointerCapture/);
  assert.match(
    editor,
    /transform:\s*`translate\(\$\{panelOffset\.x\}px,\s*\$\{panelOffset\.y\}px\)`/,
  );
  assert.match(editor, /ref=\{panelRef\}/);
  assert.match(editor, /data-quick-day-drag-handle="true"/);
  assert.match(editor, /cursor-grab/);
  assert.match(editor, /cursor-grabbing/);
  assert.match(editor, /bg-black\/15/);
  assert.doesNotMatch(editor, /bg-black\/30/);

  // Drag on panel (dialog), not overlay
  assert.match(
    editor,
    /ref=\{panelRef\}[\s\S]{0,200}transform:\s*`translate\(\$\{panelOffset\.x\}px,\s*\$\{panelOffset\.y\}px\)`/,
  );
  assert.match(
    editor,
    /role="presentation"[\s\S]*handleBackdropClick|handleBackdropClick[\s\S]*role="presentation"/,
  );

  // Interactive elements / close button don't start drag
  assert.match(
    editor,
    /closest\(\s*"button, a, input, select, textarea, label, \[role='button'\]"/,
  );
  assert.match(
    editor,
    /aria-label="Закрыть"[\s\S]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}|onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]*aria-label="Закрыть"/,
  );

  // Overlap pauses drag
  assert.match(editor, /canDrag\s*=\s*desktopDragEnabled\s*&&\s*!overlapConfirmOpen/);
  assert.match(editor, /onOverlapConfirmChange=\{setOverlapConfirmOpen\}/);
  assert.match(form, /onOverlapConfirmChange\?/);

  // Resize reclamps; unmount resets offset via fresh state
  assert.match(editor, /addEventListener\("resize"/);
  assert.match(editor, /useState\(\{\s*x:\s*0,\s*y:\s*0\s*\}\)/);

  // Body scroll, header fixed
  assert.match(editor, /overflow-y-auto/);
  assert.match(editor, /data-quick-day-drag-handle[\s\S]*overflow-y-auto|overflow-y-auto[\s\S]*data-quick-day-drag-handle/);

  // Overlap a11y from prior work still present
  assert.match(form, /role="alertdialog"/);
  assert.match(form, /event\.key === "Escape"/);
  assert.match(form, /overlapCancelButtonRef\.current\?\.focus\(\)/);
  assert.match(form, /submitButtonRef\.current\?\.focus\(\)/);

  // Alertdialog stays inside form (no portal/fixed)
  assert.match(
    form,
    /showOverlapConfirm \? \(\s*<div[\s\S]*role="alertdialog"/,
  );
  assert.doesNotMatch(
    form,
    /createPortal|role="alertdialog"[\s\S]*fixed inset/,
  );

  console.log("security-quick-day-editor-drag-check: OK");
}

main();
