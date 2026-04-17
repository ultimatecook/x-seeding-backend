-- Add discount code string fields to Seeding
ALTER TABLE "Seeding" ADD COLUMN "productDiscountCode"  TEXT;
ALTER TABLE "Seeding" ADD COLUMN "shippingDiscountCode" TEXT;

-- Add inventory location tracking to SeedingProduct
ALTER TABLE "SeedingProduct" ADD COLUMN "inventoryLocationId" TEXT;

-- InventoryLocation table
CREATE TABLE "InventoryLocation" (
  "id"                SERIAL NOT NULL,
  "shop"              TEXT NOT NULL,
  "shopifyLocationId" TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "isEnabled"         BOOLEAN NOT NULL DEFAULT true,
  "priorityOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryLocation_shop_shopifyLocationId_key"
  ON "InventoryLocation"("shop", "shopifyLocationId");

CREATE INDEX "InventoryLocation_shop_isEnabled_priorityOrder_idx"
  ON "InventoryLocation"("shop", "isEnabled", "priorityOrder");

-- DiscountCode enums + table
CREATE TYPE "DiscountPoolType"   AS ENUM ('Product', 'Shipping');
CREATE TYPE "DiscountCodeStatus" AS ENUM ('Available', 'Assigned', 'Used');

CREATE TABLE "DiscountCode" (
  "id"                SERIAL NOT NULL,
  "shop"              TEXT NOT NULL,
  "poolType"          "DiscountPoolType" NOT NULL,
  "code"              TEXT NOT NULL,
  "status"            "DiscountCodeStatus" NOT NULL DEFAULT 'Available',
  "assignedSeedingId" INTEGER,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscountCode_assignedSeedingId_fkey"
    FOREIGN KEY ("assignedSeedingId") REFERENCES "Seeding"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DiscountCode_shop_code_key"
  ON "DiscountCode"("shop", "code");

CREATE INDEX "DiscountCode_shop_poolType_status_idx"
  ON "DiscountCode"("shop", "poolType", "status");

CREATE INDEX "DiscountCode_assignedSeedingId_idx"
  ON "DiscountCode"("assignedSeedingId");
