import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const config = await prisma.gameConfig.findUnique({ where: { id: "default" } });
  const gifts = await prisma.gameGift.findMany({ orderBy: { probability: "desc" } });

  console.log("GameConfig:", config ? { isActive: config.isActive, title: config.title } : null);
  console.log(
    "GameGift:",
    gifts.map((g) => ({
      name: g.name,
      probability: g.probability,
      requiredPremiumLevel: g.requiredPremiumLevel,
      isActive: g.isActive,
      allowedGameDirections: g.allowedGameDirections,
      allowedResultTypes: g.allowedResultTypes,
    })),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

