/**
 * Проверка правил доступности подарков (без UI, без случайного выбора).
 * Запуск: node scripts/test-game-gift-eligibility.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeToken(value) {
  return value.trim().toLowerCase();
}

function isAllowed(list, value) {
  if (list.length === 0) return true;
  const token = normalizeToken(value);
  return list.some((entry) => normalizeToken(entry) === token);
}

function getEligibleGifts(gifts, { gameDirection, resultType, premiumLevel }) {
  return gifts.filter((gift) => {
    if (!gift.isActive) return false;
    if (premiumLevel < gift.requiredPremiumLevel) return false;
    if (!isAllowed(gift.allowedGameDirections, gameDirection)) return false;
    if (!isAllowed(gift.allowedResultTypes, resultType)) return false;
    return true;
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

async function main() {
  const gifts = await prisma.gameGift.findMany({ orderBy: { probability: "desc" } });
  console.log(`Gifts in DB: ${gifts.length}\n`);

  // --- Сценарий 1: faceCare, premiumLevel = 0 ---
  const s1 = {
    gameDirection: "faceCare",
    skinNeed: "hydration",
    resultType: "skinQuality",
    premiumLevel: 0,
  };
  const eligible1 = getEligibleGifts(gifts, s1);
  console.log("=== Сценарий 1: faceCare, premiumLevel = 0 ===");
  console.log("Input:", s1);
  console.log(
    "Eligible:",
    eligible1.map((g) => ({ name: g.name, prob: g.probability, req: g.requiredPremiumLevel })),
  );
  assert(
    eligible1.some((g) => g.name === "Уход для рук" || g.name === "Холодная плазма губ"),
    "доступен обычный подарок",
  );
  assert(
    !eligible1.some((g) => g.name === "Формула сияния"),
    "Формула сияния недоступна",
  );

  // --- Сценарий 2: recovery, premiumLevel = 3 ---
  const s2 = {
    gameDirection: "recovery",
    skinNeed: "restoration",
    resultType: "recovery",
    premiumLevel: 3,
  };
  const eligible2 = getEligibleGifts(gifts, s2);
  console.log("\n=== Сценарий 2: recovery, premiumLevel = 3 ===");
  console.log("Input:", s2);
  console.log(
    "Eligible:",
    eligible2.map((g) => ({ name: g.name, prob: g.probability, req: g.requiredPremiumLevel })),
  );
  assert(
    eligible2.some((g) => g.name === "Формула сияния"),
    "Формула сияния доступна при recovery и premiumLevel=3",
  );

  // --- Сценарий 3: faceCare, premiumLevel = 3 ---
  const s3 = {
    gameDirection: "faceCare",
    skinNeed: "hydration",
    resultType: "skinQuality",
    premiumLevel: 3,
  };
  const eligible3 = getEligibleGifts(gifts, s3);
  console.log("\n=== Сценарий 3: faceCare, premiumLevel = 3 ===");
  console.log("Input:", s3);
  console.log(
    "Eligible:",
    eligible3.map((g) => ({ name: g.name, prob: g.probability, req: g.requiredPremiumLevel })),
  );
  assert(
    !eligible3.some((g) => g.name === "Формула сияния"),
    "Формула сияния НЕ доступна при faceCare, даже если premiumLevel=3",
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
