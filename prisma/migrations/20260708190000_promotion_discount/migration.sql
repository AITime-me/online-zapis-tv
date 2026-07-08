-- CreateEnum
CREATE TYPE "DiscountUnit" AS ENUM ('PERCENT', 'FIXED');

-- AlterEnum
ALTER TYPE "PromotionType" ADD VALUE 'DISCOUNT';

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN "discount_value" DECIMAL(10,2),
ADD COLUMN "discount_unit" "DiscountUnit",
ADD COLUMN "discount_description" TEXT;
