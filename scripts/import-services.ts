/**
 * Импорт услуг студии «Твоё время».
 *
 * Usage:
 *   npx tsx scripts/import-services.ts
 *   npx tsx scripts/import-services.ts --apply --confirm-staging
 *   npx tsx scripts/import-services.ts --apply --confirm-staging --disable-stale-bindings
 *
 * Запись (--apply) только при APP_ENV=staging и --confirm-staging.
 * Production apply запрещён. Секреты и DATABASE_URL в лог не выводятся.
 */

import { PrismaClient } from "@prisma/client";
import {
  assertCatalogImportWriteAllowed,
  applyCatalogImportPlan,
  buildCatalogImportPlan,
  CatalogImportCliError,
  createPrismaCatalogImportRepository,
  formatCatalogImportReport,
  parseImportServicesArgs,
  planAllowsApply,
} from "./lib/catalog-service-import";

function argvFlags(): string[] {
  return process.argv.slice(2);
}

async function main(): Promise<void> {
  let flags;
  try {
    flags = parseImportServicesArgs(argvFlags());
    assertCatalogImportWriteAllowed(flags);
  } catch (error) {
    if (error instanceof CatalogImportCliError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const prisma = new PrismaClient();
  try {
    const repo = createPrismaCatalogImportRepository(
      prisma as unknown as Parameters<typeof createPrismaCatalogImportRepository>[0],
    );
    const plan = await buildCatalogImportPlan(repo);
    console.log(formatCatalogImportReport(plan, flags));

    if (!planAllowsApply(plan)) {
      process.exitCode = 1;
      if (flags.apply) {
        console.error("\n--apply отменён: есть ошибки или конфликты.");
      }
      return;
    }

    if (!flags.apply) {
      return;
    }

    const result = await applyCatalogImportPlan(repo, plan, flags);
    console.log("");
    console.log("--- APPLY RESULT ---");
    console.log(`Categories created: ${result.createdCategories}`);
    console.log(`Services created: ${result.createdServices}`);
    console.log(`Services updated: ${result.updatedServices}`);
    console.log(`Services unchanged: ${result.unchangedServices}`);
    console.log(`MasterService created: ${result.createdLinks}`);
    console.log(`MasterService updated: ${result.updatedLinks}`);
    console.log(`MasterService stale disabled: ${result.disabledStaleLinks}`);
  } catch (error) {
    if (error instanceof CatalogImportCliError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error("[catalog-import] failed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
