import fs from "node:fs";
import {
  classifyPrismaMigrateStatus,
  formatMigrateStatusResult,
} from "./prisma-migrate-status";

const exitCode = Number(process.argv[2]);

if (!Number.isInteger(exitCode)) {
  console.error("usage: classify-migrate-status-cli.ts <exitCode>  (read prisma output from stdin)");
  process.exit(2);
}

const output = fs.readFileSync(0, "utf8");
const result = classifyPrismaMigrateStatus(exitCode, output);
process.stdout.write(formatMigrateStatusResult(result));
