/**
 * Source/contract checks for the public wheel controller integration.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main(): void {
  const controller = read("src/components/game/wheel-fortune-public.tsx");
  const adapter = read("src/components/game/wheel-public-ui-adapter.ts");
  const wheelUiDir = path.join(ROOT, "src/components/game/wheel-ui");

  assert.match(controller, /WheelFortuneView/);
  assert.match(controller, /mapUiPreferencesToCompletePayload/);
  assert.match(controller, /PhoneCountrySelect/);
  assert.match(controller, /BookingLegalConsentFields/);
  assert.match(controller, /Idempotency-Key/);
  assert.match(controller, /wheel_attempt_/);
  assert.match(controller, /wheel_claim_idempotency_/);
  assert.match(controller, /credentials:\s*"include"/);
  assert.match(controller, /\/api\/game\/wheel\/start/);
  assert.match(controller, /\/api\/game\/wheel\/complete/);
  assert.match(controller, /\/api\/game\/wheel\/result/);
  assert.match(controller, /restored-pending/);
  assert.match(controller, /validateClientContactFields/);
  assert.match(controller, /requestBusy|setRequestBusy/);
  assert.match(controller, /completeRequestSerial/);
  assert.match(controller, /mountedRef/);
  assert.match(controller, /setConfettiActive\(false\)/);
  assert.match(controller, /onIntentChange/);
  assert.match(
    controller,
    /intent === ["']undecided["'][\s\S]*?setSelectedZone\(null\)/,
  );

  // Opaque keys only in sessionStorage — no PII field names written.
  assert.doesNotMatch(
    controller,
    /sessionStorage\.setItem\([^)]*(name|phone|consent|interest|zone|prize)/i,
  );
  assert.doesNotMatch(controller, /localStorage/);

  // /start payload must not include preferences.
  const startBodyMatch = controller.match(
    /fetch\("\/api\/game\/wheel\/start"[\s\S]*?body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/,
  );
  assert.ok(startBodyMatch, "start JSON body not found");
  const startBody = startBodyMatch[1] ?? "";
  assert.doesNotMatch(startBody, /\binterest\b/);
  assert.doesNotMatch(startBody, /confirmedZone/);
  assert.doesNotMatch(startBody, /selectedIntent/);
  assert.match(startBody, /attemptId/);
  assert.match(startBody, /personalDataConsent:\s*true/);

  // /complete uses mapped interest; confirmedZone only when present on payload.
  assert.match(controller, /mapped\.payload\.interest/);
  assert.match(controller, /mapped\.payload\.confirmedZone/);
  assert.match(
    controller,
    /if\s*\(\s*mapped\.payload\.confirmedZone\s*\)/,
    "confirmedZone must be attached only when mapping requires it",
  );

  assert.match(adapter, /never sends donor intent "primary"/i);
  assert.match(adapter, /interest: zone/);
  assert.match(adapter, /interest: "undecided"/);

  for (const file of fs.readdirSync(wheelUiDir)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = fs.readFileSync(path.join(wheelUiDir, file), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /sessionStorage|localStorage/);
  }

  // Backend surfaces untouched by this stage's controller wiring expectation.
  for (const rel of [
    "src/services/WheelPublicGameService.ts",
    "src/app/api/game/wheel/start/route.ts",
    "src/app/api/game/wheel/complete/route.ts",
    "src/app/api/game/wheel/result/route.ts",
    "prisma/schema.prisma",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
  }

  console.log("wheel-public-controller checks: OK");
}

main();
