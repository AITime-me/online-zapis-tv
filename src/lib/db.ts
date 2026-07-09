import { PrismaClient } from "@prisma/client";

/** Bump after Prisma schema changes so dev HMR does not keep a stale PrismaClient. */
const PRISMA_CLIENT_CACHE_KEY = "bot-settings-log-retention-v1";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaClientCacheKey?: string;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const cachedClient =
  globalForPrisma.prismaClientCacheKey === PRISMA_CLIENT_CACHE_KEY
    ? globalForPrisma.prisma
    : undefined;

export const prisma = cachedClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaClientCacheKey = PRISMA_CLIENT_CACHE_KEY;
}
