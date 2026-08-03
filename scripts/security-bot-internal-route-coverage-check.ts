import fs from "node:fs";
import path from "node:path";

/**
 * Must match `BOT_INTERNAL_API_WRAPPER_NAME` / export in
 * `src/lib/auth/bot-internal-api.ts` (kept as literal to avoid importing server-only).
 */
const BOT_INTERNAL_API_WRAPPER_NAME = "withBotInternalApi";

/**
 * Mandatory coverage: every App Router handler under
 * src/app/api/internal/bot/v1/ (any nested route.ts) must export handlers via
 * withBotInternalApi(...).
 *
 * Comment-only mentions of the wrapper name do not satisfy the contract.
 */

const HANDLER_EXPORT_WITH_WRAPPER = new RegExp(
  String.raw`export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*${BOT_INTERNAL_API_WRAPPER_NAME}\s*\(`,
  "g",
);

const BARE_HANDLER_EXPORT =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;

const ANY_CONST_HANDLER =
  /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;

export type BotInternalRouteCoverageIssue = {
  file: string;
  reason: string;
};

function listRouteFiles(rootDir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    if (!fs.existsSync(currentDir)) {
      return;
    }
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "route.ts") {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

export function assertRouteSourceUsesBotInternalApi(source: string): void {
  const wrappedMethods = new Set(
    [...source.matchAll(HANDLER_EXPORT_WITH_WRAPPER)].map((match) => match[1]),
  );

  if (wrappedMethods.size === 0) {
    throw new Error(
      `missing export const METHOD = ${BOT_INTERNAL_API_WRAPPER_NAME}(...)`,
    );
  }

  const bareFn = [...source.matchAll(BARE_HANDLER_EXPORT)].map((m) => m[1]);
  if (bareFn.length > 0) {
    throw new Error(
      `bare export function ${bareFn.join(",")} is not wrapped with ${BOT_INTERNAL_API_WRAPPER_NAME}`,
    );
  }

  const allConstMethods = [
    ...source.matchAll(ANY_CONST_HANDLER),
  ].map((m) => m[1]);
  for (const method of allConstMethods) {
    if (!wrappedMethods.has(method)) {
      throw new Error(
        `bare export const ${method} is not wrapped with ${BOT_INTERNAL_API_WRAPPER_NAME}`,
      );
    }
  }

  const callCount = (
    source.match(new RegExp(`${BOT_INTERNAL_API_WRAPPER_NAME}\\s*\\(`, "g")) ??
    []
  ).length;
  if (callCount < wrappedMethods.size) {
    throw new Error(`${BOT_INTERNAL_API_WRAPPER_NAME} call count mismatch`);
  }
}

export function collectBotInternalRouteCoverageIssues(
  apiRoot = path.join("src", "app", "api", "internal", "bot", "v1"),
): BotInternalRouteCoverageIssue[] {
  const issues: BotInternalRouteCoverageIssue[] = [];
  const absoluteRoot = path.isAbsolute(apiRoot)
    ? apiRoot
    : path.join(process.cwd(), apiRoot);
  const files = listRouteFiles(absoluteRoot);

  if (files.length === 0) {
    issues.push({
      file: absoluteRoot,
      reason: "no bot/v1 route.ts files found (unexpected empty namespace)",
    });
    return issues;
  }

  for (const file of files) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    try {
      assertRouteSourceUsesBotInternalApi(source);
    } catch (error) {
      issues.push({
        file: relative,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return issues;
}

export function assertBotInternalRouteCoverage(apiRoot?: string): string[] {
  const issues = collectBotInternalRouteCoverageIssues(apiRoot);
  if (issues.length > 0) {
    const details = issues
      .map((issue) => `${issue.file}: ${issue.reason}`)
      .join("\n");
    throw new Error(`Bot internal route auth coverage failed:\n${details}`);
  }

  const absoluteRoot = path.isAbsolute(apiRoot ?? "")
    ? (apiRoot as string)
    : path.join(
        process.cwd(),
        apiRoot ?? path.join("src", "app", "api", "internal", "bot", "v1"),
      );
  return listRouteFiles(absoluteRoot).map((file) =>
    path.relative(process.cwd(), file).split(path.sep).join("/"),
  );
}

if (
  process.argv[1]?.replace(/\\/g, "/").endsWith("security-bot-internal-route-coverage-check.ts")
) {
  const routes = assertBotInternalRouteCoverage();
  console.log(
    `security-bot-internal-route-coverage-check: OK (${routes.length} route(s): ${routes.join(", ")})`,
  );
}
