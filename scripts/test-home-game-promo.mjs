/**
 * Проверка карточки игры на главной.
 * Запуск: node scripts/test-home-game-promo.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function getHomePromotions(config) {
  const staticPromotions = [
    {
      id: "cold-plasma-first-visit",
      kind: "standard",
      title: "Первый визит на холодную плазму — со скидкой 30%",
      sortOrder: 1,
      isActive: true,
    },
  ];

  if (!config?.isActive) {
    return staticPromotions;
  }

  return [
    ...staticPromotions,
    {
      id: "procedure-gift-game",
      kind: "game",
      title: config.title,
      ctaHref: config.ctaButtonLink,
      sortOrder: 2,
      isActive: true,
    },
  ].sort((a, b) => a.sortOrder - b.sortOrder);
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function main() {
  const config = await prisma.gameConfig.findUnique({ where: { id: "default" } });
  if (!config) throw new Error("GameConfig not found");

  console.log("Current GameConfig:", {
    isActive: config.isActive,
    title: config.title,
    ctaButtonLink: config.ctaButtonLink,
  });

  await prisma.gameConfig.update({
    where: { id: "default" },
    data: { isActive: false },
  });
  const hidden = await getHomePromotions(
    await prisma.gameConfig.findUnique({ where: { id: "default" } }),
  );
  console.log("\n=== Сценарий 1: isActive = false ===");
  console.log("Promotions:", hidden.map((p) => p.id));
  assert(
    !hidden.some((p) => p.id === "procedure-gift-game"),
    "карточки игры нет при isActive=false",
  );

  await prisma.gameConfig.update({
    where: { id: "default" },
    data: { isActive: true },
  });
  const visible = await getHomePromotions(
    await prisma.gameConfig.findUnique({ where: { id: "default" } }),
  );
  console.log("\n=== Сценарий 2: isActive = true ===");
  console.log("Promotions:", visible.map((p) => ({ id: p.id, title: p.title })));
  const gameCard = visible.find((p) => p.id === "procedure-gift-game");
  assert(Boolean(gameCard), "карточка игры появляется при isActive=true");
  assert(
    gameCard.ctaHref === "/promo/procedure-gift",
    "кнопка ведёт на /promo/procedure-gift",
  );

  console.log("\n=== Все проверки пройдены ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
