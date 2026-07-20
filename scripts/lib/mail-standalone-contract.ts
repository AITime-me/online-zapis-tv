import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import path from "node:path";

/**
 * Post-build контракт: standalone-артефакт должен резолвить nodemailer как
 * require("nodemailer"), без Turbopack-хеша. Вызывается из npm run build и
 * test:security:mail-standalone (fail без предварительного build).
 */
export function assertMailStandaloneContract(cwd: string = process.cwd()): void {
  const standaloneRoot = path.join(cwd, ".next", "standalone");
  const standalonePkg = path.join(standaloneRoot, "package.json");

  assert.ok(
    fs.existsSync(standalonePkg),
    "отсутствует .next/standalone — сначала выполните npm run build",
  );

  const nodemailerDir = path.join(standaloneRoot, "node_modules", "nodemailer");
  assert.ok(
    fs.existsSync(nodemailerDir),
    "standalone/node_modules/nodemailer отсутствует (production MODULE_NOT_FOUND)",
  );

  const forgotRoute = path.join(
    cwd,
    ".next",
    "server",
    "app",
    "api",
    "auth",
    "forgot-password",
    "route.js",
  );
  assert.ok(fs.existsSync(forgotRoute), "отсутствует собранный forgot-password route.js");
  const routeSource = fs.readFileSync(forgotRoute, "utf8");
  assert.match(routeSource, /require\(["']nodemailer["']\)/, "forgot-password должен require('nodemailer')");
  assert.doesNotMatch(
    routeSource,
    /require\(["']nodemailer-[0-9a-f]+["']\)/,
    "hashed Turbopack require(nodemailer-<hash>) ломает Docker standalone",
  );

  const standaloneRequire = createRequire(standalonePkg);
  const moduleWithPaths = Module as typeof Module & {
    _nodeModulePaths: (from: string) => string[];
  };
  const originalPaths = moduleWithPaths._nodeModulePaths;
  moduleWithPaths._nodeModulePaths = function (from: string) {
    const paths = originalPaths.call(this, from);
    return paths.filter((p) => p.startsWith(standaloneRoot));
  };
  try {
    const nm = standaloneRequire("nodemailer") as { createTransport?: unknown };
    assert.equal(typeof nm.createTransport, "function", "standalone require('nodemailer').createTransport");
  } finally {
    moduleWithPaths._nodeModulePaths = originalPaths;
  }
}
