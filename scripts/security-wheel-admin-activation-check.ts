import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertWheelAdminActivationControls(): void {
  const panel = read("src/components/admin/wheel-fortune-panel.tsx");

  assert.match(panel, /Активировать игру/);
  assert.match(panel, /Выключить игру/);
  assert.match(panel, /Сохранить настройки/);
  assert.match(panel, /Открыть игру/);
  assert.match(panel, /patchCatalogStatus\(\s*["']active["']/);
  assert.match(panel, /patchCatalogStatus\(\s*["']disabled["']/);
  assert.match(panel, /JSON\.stringify\(\{\s*status:\s*nextStatus\s*\}\)/);
  assert.match(panel, /inFlightRef|beginRequest/);
  assert.match(panel, /sectorConfigOk/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /initialStatus/);
  assert.match(
    panel,
    /\/api\/admin\/games\/\$\{encodeURIComponent\(gameCatalogId\)\}/,
  );

  // Activate only for draft|disabled — not active/archived.
  const showActivateAssign = panel.match(
    /const showActivateButton\s*=\s*([^;]+);/,
  );
  assert.ok(showActivateAssign, "showActivateButton assignment must exist");
  assert.match(
    showActivateAssign[1]!,
    /catalogStatus\s*===\s*["']draft["']/,
  );
  assert.match(
    showActivateAssign[1]!,
    /catalogStatus\s*===\s*["']disabled["']/,
  );
  assert.doesNotMatch(
    showActivateAssign[1]!,
    /active|archived/,
    "showActivateButton must not include active or archived",
  );
  assert.match(
    panel,
    /showDisableButton\s*=\s*catalogStatus\s*===\s*["']active["']/,
  );
  assert.match(
    panel,
    /catalogStatus\s*===\s*["']archived["'][\s\S]*?Архивная игра не активируется/,
  );

  // Meta save must not force draft status.
  assert.doesNotMatch(
    panel,
    /status:\s*["']draft["']/,
    "wheel admin meta save must not force status draft",
  );
  const metaSave = panel.match(
    /const saveCatalogMeta = async \(\) => \{([\s\S]*?)\n  \};/,
  );
  assert.ok(metaSave, "saveCatalogMeta must exist");
  assert.match(
    metaSave[1]!,
    /JSON\.stringify\(\{\s*title:[\s\S]*?slug:[\s\S]*?description:[\s\S]*?\}\)/,
  );
  assert.doesNotMatch(
    metaSave[1]!,
    /\bstatus\b/,
    "saveCatalogMeta must omit status so current catalog status is preserved",
  );

  // Activation depends on sectorConfigOk (disabled when invalid).
  assert.match(
    panel,
    /disabled=\{busy \|\| !canActivate\}|disabled=\{!canActivate \|\| busy\}/,
  );
  assert.match(panel, /canActivate\s*=\s*[\s\S]*sectorConfigOk/);

  // M1: success-reset timeout must be cancellable and generation-guarded.
  assert.match(panel, /clearSuccessReset|successResetTimeoutRef/);
  assert.match(panel, /requestGenerationRef/);
  assert.match(panel, /markSaved\s*=/);
  assert.match(
    panel,
    /beginRequest[\s\S]*?clearSuccessReset\s*\(/,
    "new requests must clear the previous success-reset timeout",
  );
  assert.match(
    panel,
    /setStatus\(\(current\)\s*=>\s*\(current\s*===\s*["']saved["']\s*\?\s*["']idle["']\s*:\s*current\)\)/,
    "idle reset must only apply while status is still saved",
  );
  assert.doesNotMatch(
    panel,
    /window\.setTimeout\(\s*\(\)\s*=>\s*setStatus\(\s*["']idle["']\s*\)/,
    "must not unconditionally setStatus('idle') from a bare timeout",
  );
  assert.match(
    panel,
    /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?return\s*\(\)\s*=>\s*\{[\s\S]*?clearSuccessReset\s*\(/,
    "success-reset timeout must clear on unmount",
  );

  // L1: successful PATCH updates local status even if refresh fails.
  assert.match(panel, /applyGameSnapshot/);
  assert.match(
    panel,
    /Статус изменён, но не удалось обновить данные страницы/,
  );

  // No direct DB access from the client panel.
  assert.doesNotMatch(panel, /from\s+["']@\/lib\/db["']/);
  assert.doesNotMatch(panel, /\bprisma\b/);

  // Public renderer must remain untouched by this admin control work.
  const publicRenderer = read("src/components/game/wheel-fortune-public.tsx");
  assert.match(publicRenderer, /"use client"/);
  assert.match(publicRenderer, /\/api\/game\/wheel\/start/);

  // Catch-Time admin editor remains a separate component path.
  const detailPage = read("src/app/admin/games/[id]/page.tsx");
  assert.match(detailPage, /game\.type === ["']catch_time["']/);
  assert.match(detailPage, /GamePanel/);
  assert.match(detailPage, /WheelFortunePanel/);
  assert.match(detailPage, /initialStatus=\{data\.status\}/);

  const adminService = read("src/services/GameAdminService.ts");
  assert.match(adminService, /status:\s*mapWheelAdminStatusDto\(catalog\.status\)/);
  assert.match(adminService, /GameCatalogStatusDto/);

  const catalogService = read("src/services/GameCatalogService.ts");
  assert.match(catalogService, /assertWheelCatalogReadyForActivation/);
  assert.match(
    catalogService,
    /nextStatus === ["']active["'] && nextType === ["']wheel_of_fortune["']/,
  );

  const patchRoute = read("src/app/api/admin/games/[id]/route.ts");
  assert.match(patchRoute, /requireProtectedMutatingApi/);
  assert.match(patchRoute, /updateGameCatalog/);
}

function main(): void {
  assertWheelAdminActivationControls();
  console.log("security-wheel-admin-activation-check: OK");
}

main();
