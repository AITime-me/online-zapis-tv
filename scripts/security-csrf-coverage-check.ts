import fs from "node:fs";
import path from "node:path";
import {
  MUTATING_HANDLER_PATTERN,
  PROTECTED_MUTATING_ROUTE_GUARD,
  apiPathnameFromRouteFile,
  isDynamicApiRouteFile,
  requiresAdminCsrfProtection,
} from "../src/lib/security/csrf-route-rules";

type CoverageIssue = {
  file: string;
  method: string;
  pathname: string;
  reason: string;
};

function listRouteFiles(rootDir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
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
  return results;
}

function extractMutatingHandlers(source: string): string[] {
  const methods: string[] = [];
  const pattern = new RegExp(MUTATING_HANDLER_PATTERN.source, "g");
  let match = pattern.exec(source);

  while (match) {
    methods.push(match[1]);
    match = pattern.exec(source);
  }

  return methods;
}

export function collectCsrfCoverageIssues(apiRoot = path.join("src", "app", "api")): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  const files = listRouteFiles(apiRoot);

  for (const file of files) {
    const relativePath = file.split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    const pathname = apiPathnameFromRouteFile(relativePath);
    const methods = extractMutatingHandlers(source);

    if (methods.length === 0) {
      continue;
    }

    if (isDynamicApiRouteFile(relativePath)) {
      if (!PROTECTED_MUTATING_ROUTE_GUARD.test(source)) {
        for (const method of methods) {
          if (requiresAdminCsrfProtection(pathname || relativePath, method)) {
            issues.push({
              file: relativePath,
              method,
              pathname: pathname || relativePath,
              reason: "dynamic route must use requireProtectedMutatingApi(request)",
            });
          }
        }
      }
      continue;
    }

    for (const method of methods) {
      if (!requiresAdminCsrfProtection(pathname, method)) {
        continue;
      }

      if (!PROTECTED_MUTATING_ROUTE_GUARD.test(source)) {
        issues.push({
          file: relativePath,
          method,
          pathname,
          reason: "missing requireProtectedMutatingApi / requireProtectedInternalMutatingApi",
        });
      }
    }
  }

  return issues;
}

function collectBookingRequestOriginGuardIssues(): CoverageIssue[] {
  const routeFile = path.join("src", "app", "api", "booking", "request", "route.ts");
  if (!fs.existsSync(routeFile)) {
    return [
      {
        file: "src/app/api/booking/request/route.ts",
        method: "POST",
        pathname: "/api/booking/request",
        reason: "booking request route file is missing",
      },
    ];
  }

  const source = fs.readFileSync(routeFile, "utf8");
  if (!source.includes("enforceSameOriginForMutatingRequest")) {
    return [
      {
        file: "src/app/api/booking/request/route.ts",
        method: "POST",
        pathname: "/api/booking/request",
        reason: "booking request route must call enforceSameOriginForMutatingRequest",
      },
    ];
  }

  return [];
}

function collectManageOriginGuardIssues(): CoverageIssue[] {
  const routes = [
    {
      file: "src/app/api/booking/manage/cancel/route.ts",
      pathname: "/api/booking/manage/cancel",
    },
    {
      file: "src/app/api/booking/manage/reschedule-request/route.ts",
      pathname: "/api/booking/manage/reschedule-request",
    },
  ] as const;

  const issues: CoverageIssue[] = [];
  for (const route of routes) {
    if (!fs.existsSync(route.file)) {
      issues.push({
        file: route.file,
        method: "POST",
        pathname: route.pathname,
        reason: "manage mutation route file is missing",
      });
      continue;
    }
    const source = fs.readFileSync(route.file, "utf8");
    if (!source.includes("enforceSameOriginForMutatingRequest")) {
      issues.push({
        file: route.file,
        method: "POST",
        pathname: route.pathname,
        reason: "manage mutation route must call enforceSameOriginForMutatingRequest",
      });
    }
  }
  return issues;
}

export function assertCsrfRouteCoverage(apiRoot?: string): void {
  const issues = [
    ...collectCsrfCoverageIssues(apiRoot),
    ...collectBookingRequestOriginGuardIssues(),
    ...collectManageOriginGuardIssues(),
  ];
  if (issues.length > 0) {
    const details = issues
      .map((issue) => `${issue.file} [${issue.method} ${issue.pathname}]: ${issue.reason}`)
      .join("\n");
    throw new Error(`CSRF route coverage failed:\n${details}`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("security-csrf-coverage-check.ts")) {
  assertCsrfRouteCoverage();
  console.log("CSRF route coverage passed.");
}
