/**
 * Комплексная проверка ролей и серверных прав доступа.
 *
 * Сочетает:
 * - фактические проверки permission / session-freshness / DTO;
 * - статический аудит защищённых API и страниц (исполняемый код без комментариев).
 *
 * Не подключается к staging/БД и не создаёт пользователей.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { UserRole } from "@prisma/client";
import {
  canAccessAdminPath,
  canAccessAdminSection,
  canAccessEmergencyExport,
  canEditBotAdmin,
  canManageClientsAdmin,
  canManageGameAdmin,
  canManageOperationalEntities,
  canManagePromotionsAdmin,
  canManageSystemSettings,
  canManageUsersAdmin,
  canViewBotAdmin,
  INTERNAL_ROLES,
  OPERATIONAL_ADMIN_ROLES,
  OWNER_ROLES,
} from "../src/lib/auth/permissions";
import { verifySessionFreshness } from "../src/lib/auth/session-freshness";
import {
  buildHealthErrorResponse,
  buildHealthSuccessResponse,
} from "../src/lib/health/health-response";
import {
  assertMasterAppointmentShape,
  collectForbiddenMasterAppointmentKeys,
  FORBIDDEN_MASTER_APPOINTMENT_KEYS,
} from "../src/lib/schedule/appointment-contract";
import {
  toMasterScheduleBookingRequest,
  type FullScheduleBookingRequestDto,
} from "../src/lib/schedule/booking-request-schedule";
import {
  scheduleLoadOptionsForRole,
} from "../src/lib/schedule/schedule-load-options";

const ROOT = process.cwd();

/** Канонические наборы ролей API (дублируют api-access без импорта NextAuth). */
const WRITE_SCHEDULE_ROLES = OPERATIONAL_ADMIN_ROLES;
const CLIENTS_ADMIN_ROLES = OPERATIONAL_ADMIN_ROLES;
const EXPORT_ALLOWED_ROLES = OPERATIONAL_ADMIN_ROLES;
const USERS_ADMIN_ROLES = OWNER_ROLES;
const BOT_SETTINGS_VIEW_ROLES = OWNER_ROLES;
const BOT_SETTINGS_EDIT_ROLES = OWNER_ROLES;
const GAME_ADMIN_ROLES = OWNER_ROLES;
const PROMOTIONS_ADMIN_ROLES = OWNER_ROLES;
const SYSTEM_SETTINGS_ADMIN_ROLES = OWNER_ROLES;
const INTERNAL_API_ROLES = INTERNAL_ROLES;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function listFiles(relDir: string, suffix: string): string[] {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) {
    return [];
  }
  return fs
    .readdirSync(abs, { recursive: true })
    .map((entry) => `${relDir}/${String(entry).replace(/\\/g, "/")}`)
    .filter((p) => p.endsWith(suffix));
}

function createMockDb(state: {
  isActive: boolean;
  role: UserRole;
  passwordChangedAt: Date | null;
} | null) {
  return {
    user: {
      async findUnique() {
        return state;
      },
    },
  };
}

function jwtSession(role: UserRole, authTime = 1_700_000_000) {
  return {
    user: { id: "u1", role, email: "a@b.c", name: "A" },
    authTime,
  };
}

// --- 1. Permission matrix (фактические функции) ---
function testPermissionMatrix(): void {
  const roles: UserRole[] = ["OWNER", "MANAGER", "MASTER"];

  for (const role of roles) {
    assert.equal(
      canManageUsersAdmin(role),
      role === "OWNER",
      `users: ${role}`,
    );
    assert.equal(canViewBotAdmin(role), role === "OWNER", `bot view: ${role}`);
    assert.equal(canEditBotAdmin(role), role === "OWNER", `bot edit: ${role}`);
    assert.equal(
      canManageGameAdmin(role),
      role === "OWNER",
      `game: ${role}`,
    );
    assert.equal(
      canManagePromotionsAdmin(role),
      role === "OWNER",
      `promotions: ${role}`,
    );
    assert.equal(
      canManageSystemSettings(role),
      role === "OWNER",
      `settings: ${role}`,
    );
    assert.equal(
      canManageClientsAdmin(role),
      role === "OWNER" || role === "MANAGER",
      `clients: ${role}`,
    );
    assert.equal(
      canAccessEmergencyExport(role),
      role === "OWNER" || role === "MANAGER",
      `emergency-export: ${role}`,
    );
    assert.equal(
      canManageOperationalEntities(role),
      role === "OWNER" || role === "MANAGER",
      `operational: ${role}`,
    );
  }

  assert.equal(canAccessAdminSection("OWNER", "users"), true);
  assert.equal(canAccessAdminSection("MANAGER", "users"), false);
  assert.equal(canAccessAdminSection("MASTER", "users"), false);
  assert.equal(canAccessAdminSection("MANAGER", "bot"), false);
  assert.equal(canAccessAdminSection("MANAGER", "clients"), true);
  assert.equal(canAccessAdminSection("MASTER", "clients"), false);
  assert.equal(canAccessAdminSection("MASTER", "emergency-export"), false);

  assert.equal(canAccessAdminPath("OWNER", "/admin/users"), true);
  assert.equal(canAccessAdminPath("MANAGER", "/admin/users"), false);
  assert.equal(canAccessAdminPath("MANAGER", "/admin/bot"), false);
  assert.equal(canAccessAdminPath("MANAGER", "/admin/games"), false);
  assert.equal(canAccessAdminPath("MANAGER", "/admin/clients"), true);
  assert.equal(canAccessAdminPath("MASTER", "/admin/clients"), false);

  assert.deepEqual([...USERS_ADMIN_ROLES], [...OWNER_ROLES]);
  assert.deepEqual([...BOT_SETTINGS_VIEW_ROLES], [...OWNER_ROLES]);
  assert.deepEqual([...BOT_SETTINGS_EDIT_ROLES], [...OWNER_ROLES]);
  assert.deepEqual([...GAME_ADMIN_ROLES], [...OWNER_ROLES]);
  assert.deepEqual([...PROMOTIONS_ADMIN_ROLES], [...OWNER_ROLES]);
  assert.deepEqual([...SYSTEM_SETTINGS_ADMIN_ROLES], [...OWNER_ROLES]);
  assert.ok(CLIENTS_ADMIN_ROLES.includes("MANAGER"));
  assert.ok(!CLIENTS_ADMIN_ROLES.includes("MASTER"));
  assert.ok(EXPORT_ALLOWED_ROLES.includes("MANAGER"));
  assert.ok(!EXPORT_ALLOWED_ROLES.includes("MASTER"));
  assert.ok(WRITE_SCHEDULE_ROLES.includes("MANAGER"));
  assert.ok(!WRITE_SCHEDULE_ROLES.includes("MASTER"));
  assert.ok(INTERNAL_API_ROLES.includes("MASTER"));
}

// --- 2–5. Session freshness: inactive + role change ---
async function testSessionFreshnessRoleAndInactive(): Promise<void> {
  // inactive → null (не читает admin / не вызывает action)
  {
    const user = await verifySessionFreshness(
      jwtSession("OWNER"),
      createMockDb({
        isActive: false,
        role: "OWNER",
        passwordChangedAt: null,
      }),
    );
    assert.equal(user, null, "inactive → сессия отклонена");
  }

  // роль из JWT OWNER, в БД MANAGER → MANAGER
  {
    const user = await verifySessionFreshness(
      jwtSession("OWNER"),
      createMockDb({
        isActive: true,
        role: "MANAGER",
        passwordChangedAt: null,
      }),
    );
    assert.ok(user);
    assert.equal(user.role, "MANAGER");
    assert.equal(
      canManageUsersAdmin(user.role),
      false,
      "демотированный OWNER не проходит OWNER-only",
    );
  }

  // роль из JWT OWNER, в БД MASTER → MASTER
  {
    const user = await verifySessionFreshness(
      jwtSession("OWNER"),
      createMockDb({
        isActive: true,
        role: "MASTER",
        passwordChangedAt: null,
      }),
    );
    assert.ok(user);
    assert.equal(user.role, "MASTER");
    assert.equal(canManageUsersAdmin(user.role), false);
    assert.equal(CLIENTS_ADMIN_ROLES.includes(user.role), false);
    assert.equal(EXPORT_ALLOWED_ROLES.includes(user.role), false);
  }

  // OWNER проходит OWNER-only
  {
    const user = await verifySessionFreshness(
      jwtSession("MANAGER"),
      createMockDb({
        isActive: true,
        role: "OWNER",
        passwordChangedAt: null,
      }),
    );
    assert.ok(user);
    assert.equal(user.role, "OWNER");
    assert.equal(canManageUsersAdmin(user.role), true);
  }

  // anonymous / no session
  {
    const user = await verifySessionFreshness(null, createMockDb(null));
    assert.equal(user, null);
  }
}

// --- 6–10. MASTER DTO / schedule options ---
function testMasterDtoAndScheduleOptions(): void {
  const masterOpts = scheduleLoadOptionsForRole("MASTER");
  assert.equal(masterOpts.includeOperationalNotes, false);
  assert.equal(masterOpts.appointmentVisibility, "master");
  assert.equal(masterOpts.bookingRequestVisibility, "sanitized");

  const managerOpts = scheduleLoadOptionsForRole("MANAGER");
  assert.equal(managerOpts.includeOperationalNotes, true);
  assert.equal(managerOpts.appointmentVisibility, "operational");

  const ownerOpts = scheduleLoadOptionsForRole("OWNER");
  assert.equal(ownerOpts.includeOperationalNotes, true);

  const masterAppointment = {
    id: "a1",
    serviceId: "s1",
    startsAt: "2026-07-03T09:00:00.000Z",
    endsAt: "2026-07-03T10:00:00.000Z",
    clientName: "Клиент",
    serviceName: "Услуга",
    isBold: false,
    isManualTimeOverride: false,
    status: "Подтверждена",
    source: "Онлайн",
    statusCode: "CONFIRMED",
    sourceCode: "ONLINE",
    promotionLabels: ["Акция: тест"],
    masterNote: "Скидка согласована",
  };
  assert.equal(collectForbiddenMasterAppointmentKeys(masterAppointment).length, 0);
  assertMasterAppointmentShape(masterAppointment);

  for (const key of FORBIDDEN_MASTER_APPOINTMENT_KEYS) {
    assert.equal(
      key in masterAppointment,
      false,
      `MASTER appointment не должен содержать ${key}`,
    );
  }

  const fullRequest: FullScheduleBookingRequestDto = {
    id: "r1",
    createdAt: "2026-07-03T09:00:00.000Z",
    clientName: "Клиент",
    clientPhone: "+79001234567",
    comment: "внутренняя пометка менеджера",
    status: "NEW",
    type: "MANAGER_REQUEST",
    isFromGame: false,
    masterName: "Мастер",
  };
  const sanitized = toMasterScheduleBookingRequest(fullRequest);
  assert.equal("clientPhone" in sanitized, false);
  assert.equal("comment" in sanitized, false);
  assert.equal("email" in sanitized, false);
  assert.equal("normalizedPhone" in sanitized, false);
  assert.equal(sanitized.clientName, "Клиент");
}

// --- 11–14. Role constants for export / merge / users / bot ---
function testOwnerOnlyAndExportRoleConstants(): void {
  assert.ok(!EXPORT_ALLOWED_ROLES.includes("MASTER"));
  assert.ok(!CLIENTS_ADMIN_ROLES.includes("MASTER"));
  assert.ok(!USERS_ADMIN_ROLES.includes("MANAGER"));
  assert.ok(!USERS_ADMIN_ROLES.includes("MASTER"));
  assert.ok(!BOT_SETTINGS_VIEW_ROLES.includes("MANAGER"));
  assert.ok(!GAME_ADMIN_ROLES.includes("MANAGER"));
}

// --- Health + public surface markers ---
function testHealthPublicSurface(): void {
  const ok = buildHealthSuccessResponse("2026-07-15T00:00:00.000Z");
  assert.equal(ok.ok, true);
  assert.equal("database" in ok, false);
  assert.equal("detail" in ok, false);

  const err = buildHealthErrorResponse(
    true,
    "2026-07-15T00:00:00.000Z",
    new Error("Can't reach postgres://user:secret@db:5432/app"),
  );
  assert.equal(err.ok, false);
  assert.equal("detail" in err, false);
  assert.doesNotMatch(JSON.stringify(err), /postgres|secret|5432/i);
}

// --- Static: pages use server guards ---
function testProtectedPagesHaveServerGuards(): void {
  const guard = /require(Auth|Role|Owner|AdminSection)\b/;
  const pages = [
    ...listFiles("src/app/admin", "page.tsx"),
    "src/app/(internal)/schedule/page.tsx",
  ];
  assert.ok(pages.length >= 15, "ожидается набор admin/schedule страниц");
  for (const page of pages) {
    const src = stripComments(read(page));
    assert.match(src, guard, `нет серверного guard: ${page}`);
  }
}

// --- Static: protected API auth helpers ---
const PUBLIC_OR_TOKEN_API = new Set([
  "src/app/api/health/route.ts",
  "src/app/api/auth/[...nextauth]/route.ts",
  "src/app/api/auth/session/route.ts",
  "src/app/api/auth/forgot-password/route.ts",
  "src/app/api/auth/reset-password/route.ts",
  "src/app/api/booking/catalog/route.ts",
  "src/app/api/booking/services/route.ts",
  "src/app/api/booking/masters/route.ts",
  "src/app/api/booking/available-days/route.ts",
  "src/app/api/booking/slots/route.ts",
  "src/app/api/booking/create/route.ts",
  "src/app/api/booking/request/route.ts",
  "src/app/api/booking/client-context/route.ts",
  "src/app/api/booking/manage/route.ts",
  "src/app/api/booking/manage/cancel/route.ts",
  "src/app/api/booking/manage/reschedule-request/route.ts",
  "src/app/api/settings/public/route.ts",
  "src/app/api/legal-documents/[slug]/route.ts",
  "src/app/api/promotions/active/route.ts",
  "src/app/api/view/schedule/month/route.ts",
  "src/app/api/game/session/start/route.ts",
  "src/app/api/game/session/restart/route.ts",
  "src/app/api/game/session/complete/route.ts",
  "src/app/api/game/session/result/route.ts",
  "src/app/api/game/play/route.ts",
]);

const AUTH_HELPER_CALL =
  /\b(requireApiRoles|requireProtectedMutatingApi|requireInternalApiAuth|createOwnerAdminApiHandler)\s*\(/;

const MUTATING_EXPORT =
  /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;

function testProtectedApiRoutesUseAuthHelpers(): void {
  const routes = listFiles("src/app/api", "route.ts");
  assert.ok(routes.length >= 50, "ожидается полный набор API routes");

  for (const route of routes) {
    if (PUBLIC_OR_TOKEN_API.has(route)) {
      continue;
    }
    const src = stripComments(read(route));
    assert.match(
      src,
      AUTH_HELPER_CALL,
      `защищённый API без серверного auth-helper: ${route}`,
    );
  }
}

function testMutatingProtectedRoutesHaveServerAuth(): void {
  for (const route of listFiles("src/app/api", "route.ts")) {
    if (PUBLIC_OR_TOKEN_API.has(route)) {
      continue;
    }
    const src = stripComments(read(route));
    if (!MUTATING_EXPORT.test(src)) {
      continue;
    }
    assert.match(
      src,
      /requireProtectedMutatingApi|requireApiRoles|createOwnerAdminApiHandler/,
      `mutating route без серверной проверки: ${route}`,
    );
  }
}

function testOwnerOnlyRoutesUseOwnerRoleConstants(): void {
  const checks: Array<{ file: string; needle: RegExp }> = [
    { file: "src/app/api/admin/users/route.ts", needle: /USERS_ADMIN_ROLES/ },
    { file: "src/app/api/admin/users/[id]/route.ts", needle: /USERS_ADMIN_ROLES/ },
    {
      file: "src/app/api/admin/bot/settings/route.ts",
      needle: /BOT_SETTINGS_(VIEW|EDIT)_ROLES/,
    },
    {
      file: "src/app/api/admin/bot/events/route.ts",
      needle: /BOT_SETTINGS_VIEW_ROLES/,
    },
    {
      file: "src/app/api/admin/game/data/route.ts",
      needle: /GAME_ADMIN_ROLES/,
    },
    {
      file: "src/app/api/admin/clients/export/route.ts",
      needle: /CLIENTS_ADMIN_ROLES/,
    },
    {
      file: "src/app/api/admin/clients/merge/commit/route.ts",
      needle: /CLIENTS_ADMIN_ROLES/,
    },
    {
      file: "src/app/api/emergency-export/today/route.ts",
      needle: /EXPORT_ALLOWED_ROLES/,
    },
    {
      file: "src/app/api/manager-notes/route.ts",
      needle: /WRITE_SCHEDULE_ROLES/,
    },
  ];

  for (const { file, needle } of checks) {
    const src = stripComments(read(file));
    assert.match(src, needle, `ожидается role-constant в ${file}`);
    assert.doesNotMatch(
      src,
      /INTERNAL_API_ROLES/,
      `OWNER/operational endpoint не должен открывать MASTER через INTERNAL: ${file}`,
    );
  }

  // manager-notes GET больше не через requireInternalApiAuth
  const notes = stripComments(read("src/app/api/manager-notes/route.ts"));
  assert.doesNotMatch(notes, /requireInternalApiAuth/);
  assert.match(notes, /requireApiRoles\(\s*WRITE_SCHEDULE_ROLES/);
}

function testNoDirectAuthBypassOnProtectedApi(): void {
  const allow = new Set([
    "src/app/api/auth/session/route.ts",
    "src/app/api/auth/[...nextauth]/route.ts",
  ]);
  for (const route of listFiles("src/app/api", "route.ts")) {
    const src = stripComments(read(route));
    if (/from\s+["']@\/auth["']/.test(src) && !allow.has(route)) {
      assert.fail(`route импортирует @/auth в обход freshness chokepoint: ${route}`);
    }
  }
  assert.match(
    stripComments(read("src/lib/auth/api-access.ts")),
    /verifySessionFreshness\(session\)/,
  );
  assert.match(
    stripComments(read("src/lib/auth/session.ts")),
    /verifySessionFreshness\(session\)/,
  );
}

function testFreshnessSelectsRoleFromDb(): void {
  const src = stripComments(read("src/lib/auth/session-freshness.ts"));
  assert.match(src, /select:\s*\{\s*isActive:\s*true,\s*role:\s*true/);
  assert.match(src, /role:\s*state\.role/);
  assert.doesNotMatch(
    src,
    /role:\s*user\.role/,
    "нельзя возвращать role из JWT",
  );
}

function testAdminPasswordSetsPasswordChangedAt(): void {
  const src = stripComments(read("src/services/UserAdminService.ts"));
  assert.match(
    src,
    /temporaryPassword[\s\S]*passwordChangedAt\s*=\s*new Date\(\)/,
    "смена пароля админом должна ставить passwordChangedAt",
  );
}

function testApiAccessRoleConstantsMatchCanon(): void {
  const src = stripComments(read("src/lib/auth/api-access.ts"));
  const expectations: Array<{ name: string; source: string }> = [
    { name: "WRITE_SCHEDULE_ROLES", source: "OPERATIONAL_ADMIN_ROLES" },
    { name: "CLIENTS_ADMIN_ROLES", source: "OPERATIONAL_ADMIN_ROLES" },
    { name: "EXPORT_ALLOWED_ROLES", source: "OPERATIONAL_ADMIN_ROLES" },
    { name: "USERS_ADMIN_ROLES", source: "OWNER_ROLES" },
    { name: "BOT_SETTINGS_VIEW_ROLES", source: "OWNER_ROLES" },
    { name: "BOT_SETTINGS_EDIT_ROLES", source: "OWNER_ROLES" },
    { name: "GAME_ADMIN_ROLES", source: "OWNER_ROLES" },
    { name: "PROMOTIONS_ADMIN_ROLES", source: "OWNER_ROLES" },
    { name: "SYSTEM_SETTINGS_ADMIN_ROLES", source: "OWNER_ROLES" },
    { name: "INTERNAL_API_ROLES", source: "INTERNAL_ROLES" },
  ];
  for (const { name, source } of expectations) {
    assert.match(
      src,
      new RegExp(`export const ${name}: UserRole\\[] = ${source}`),
      `${name} должен равняться ${source}`,
    );
  }
}

function testPublicBookingAndHealthRemainPublic(): void {
  assert.ok(PUBLIC_OR_TOKEN_API.has("src/app/api/booking/catalog/route.ts"));
  assert.ok(PUBLIC_OR_TOKEN_API.has("src/app/api/health/route.ts"));
  const bookingPage = stripComments(read("src/app/booking/page.tsx"));
  assert.doesNotMatch(bookingPage, /require(Auth|AdminSection|Owner)/);
  const health = stripComments(read("src/app/api/health/route.ts"));
  assert.doesNotMatch(health, AUTH_HELPER_CALL);
}

function testObjectLevelIdGuardsExistForUsers(): void {
  const src = stripComments(read("src/services/UserAdminService.ts"));
  assert.match(src, /assertOwnerCanBeModified/);
  assert.match(src, /последнего активного владельца/);
}

async function main(): Promise<void> {
  testPermissionMatrix();
  await testSessionFreshnessRoleAndInactive();
  testMasterDtoAndScheduleOptions();
  testOwnerOnlyAndExportRoleConstants();
  testHealthPublicSurface();
  testProtectedPagesHaveServerGuards();
  testProtectedApiRoutesUseAuthHelpers();
  testMutatingProtectedRoutesHaveServerAuth();
  testOwnerOnlyRoutesUseOwnerRoleConstants();
  testNoDirectAuthBypassOnProtectedApi();
  testFreshnessSelectsRoleFromDb();
  testAdminPasswordSetsPasswordChangedAt();
  testApiAccessRoleConstantsMatchCanon();
  {
    const src = stripComments(read("src/lib/auth/api-access.ts"));
    assert.match(src, /status:\s*401/);
    assert.match(src, /status:\s*403/);
    assert.match(src, /Unauthorized/);
    assert.match(src, /Forbidden/);
  }
  testPublicBookingAndHealthRemainPublic();
  testObjectLevelIdGuardsExistForUsers();
  console.log("security-role-access-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
