/**
 * Защита dev-seed от случайного запуска в production.
 * Не использует opt-in флаги — только признаки production-окружения.
 */

const PRODUCTION_MARKERS = ["production", "prod"] as const;

function readProductionMarker(): string | undefined {
  return (
    process.env.APP_ENV?.trim().toLowerCase() ||
    process.env.DEPLOY_ENV?.trim().toLowerCase()
  );
}

export function isProductionEnvironment(): boolean {
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  const marker = readProductionMarker();
  return marker !== undefined && PRODUCTION_MARKERS.includes(marker as (typeof PRODUCTION_MARKERS)[number]);
}

export function assertDevSeedAllowed(): void {
  if (!isProductionEnvironment()) {
    return;
  }

  const marker = readProductionMarker();
  const details = [
    "Dev-seed (prisma/seed.ts) запрещён в production.",
    "Этот скрипт создаёт тестовых пользователей, клиентов и демо-данные.",
    "Для production используйте: npm run db:seed:production",
    "Первого владельца создайте через: npm run owner:create",
    "",
    `Обнаружено: NODE_ENV=${process.env.NODE_ENV ?? "(не задан)"}${
      marker ? `, APP_ENV/DEPLOY_ENV=${marker}` : ""
    }`,
  ].join("\n");

  console.error(details);
  process.exit(1);
}
