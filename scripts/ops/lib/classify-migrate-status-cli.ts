import fs from "node:fs";
import {
  classifyPrismaMigrateStatus,
  formatMigrateStatusResult,
} from "./prisma-migrate-status";

const exitCode = Number(process.argv[2]);
const outputFile = process.argv[3];

if (!Number.isInteger(exitCode) || !outputFile) {
  console.error("usage: classify-migrate-status-cli.ts <exitCode> <outputFile>");
  process.exit(2);
}

const output = fs.readFileSync(outputFile, "utf8");
const result = classifyPrismaMigrateStatus(exitCode, output);
process.stdout.write(formatMigrateStatusResult(result));
