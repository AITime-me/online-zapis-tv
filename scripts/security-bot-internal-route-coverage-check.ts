import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Mandatory coverage: every App Router handler under
 * src/app/api/internal/bot/v1/ (any nested route.ts) must export handlers via
 * withBotInternalApi(...) imported from the approved server module.
 *
 * Uses the TypeScript compiler API so comments, strings, dead imports, and
 * dead calls cannot produce a false green.
 */

/** Must match `BOT_INTERNAL_API_WRAPPER_NAME` in src/lib/auth/bot-internal-api.ts */
export const BOT_INTERNAL_API_WRAPPER_NAME = "withBotInternalApi";

const APPROVED_IMPORT_SPECIFIERS = new Set([
  "@/lib/auth/bot-internal-api",
  "src/lib/auth/bot-internal-api",
]);

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

export type BotInternalRouteCoverageIssue = {
  file: string;
  reason: string;
};

function hasExportModifier(
  node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> },
): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) === true
  );
}

function normalizeImportSpecifier(specifier: string): string {
  return specifier.replace(/\\/g, "/").replace(/\.ts$/, "");
}

function isApprovedImportSpecifier(specifier: string): boolean {
  const normalized = normalizeImportSpecifier(specifier);
  if (APPROVED_IMPORT_SPECIFIERS.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith("/lib/auth/bot-internal-api") ||
    normalized === "lib/auth/bot-internal-api"
  );
}

/**
 * True when `withBotInternalApi` is imported by exact name (no alias) from the
 * approved server-only module.
 */
export function findApprovedBotInternalWrapperImport(
  sourceFile: ts.SourceFile,
): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!isApprovedImportSpecifier(statement.moduleSpecifier.text)) {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      // Alias imports are rejected: propertyName present means renamed binding.
      if (element.propertyName) {
        continue;
      }
      if (element.name.text === BOT_INTERNAL_API_WRAPPER_NAME) {
        return true;
      }
    }
  }

  return false;
}

function isWithBotInternalApiCall(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) {
    return false;
  }
  return (
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === BOT_INTERNAL_API_WRAPPER_NAME
  );
}

export type AnalyzedHttpExport = {
  method: string;
  wrapped: boolean;
  kind: "variable" | "function";
};

/**
 * Analyze a route TypeScript source for HTTP method exports and whether each
 * is wrapped with the approved withBotInternalApi(...) call.
 */
export function analyzeBotInternalRouteSource(
  source: string,
  fileName = "route.ts",
): {
  hasApprovedImport: boolean;
  exports: AnalyzedHttpExport[];
} {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );

  const hasApprovedImport = findApprovedBotInternalWrapperImport(sourceFile);
  const exports: AnalyzedHttpExport[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const name = statement.name?.text;
      if (name && HTTP_METHODS.has(name)) {
        exports.push({ method: name, wrapped: false, kind: "function" });
      }
      continue;
    }

    if (
      ts.isVariableStatement(statement) &&
      hasExportModifier(statement)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const method = declaration.name.text;
        if (!HTTP_METHODS.has(method)) {
          continue;
        }

        const wrapped =
          declaration.initializer != null &&
          isWithBotInternalApiCall(declaration.initializer);

        exports.push({
          method,
          wrapped: wrapped && hasApprovedImport,
          kind: "variable",
        });
      }
    }
  }

  return { hasApprovedImport, exports };
}

export function assertRouteSourceUsesBotInternalApi(
  source: string,
  fileName = "route.ts",
): void {
  const analysis = analyzeBotInternalRouteSource(source, fileName);

  if (analysis.exports.length === 0) {
    throw new Error(
      `no exported HTTP method handlers found (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)`,
    );
  }

  if (!analysis.hasApprovedImport) {
    throw new Error(
      `missing exact named import { ${BOT_INTERNAL_API_WRAPPER_NAME} } from approved @/lib/auth/bot-internal-api`,
    );
  }

  for (const entry of analysis.exports) {
    if (!entry.wrapped) {
      throw new Error(
        `exported ${entry.kind} ${entry.method} is not wrapped with ${BOT_INTERNAL_API_WRAPPER_NAME}(...)`,
      );
    }
  }
}

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
      assertRouteSourceUsesBotInternalApi(source, relative);
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
  process.argv[1]
    ?.replace(/\\/g, "/")
    .endsWith("security-bot-internal-route-coverage-check.ts")
) {
  const routes = assertBotInternalRouteCoverage();
  console.log(
    `security-bot-internal-route-coverage-check: OK (${routes.length} route(s): ${routes.join(", ")})`,
  );
}
