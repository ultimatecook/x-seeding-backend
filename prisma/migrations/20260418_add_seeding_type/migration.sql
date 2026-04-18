-- Add LocationType enum and locationType to InventoryLocation
CREATE TYPE "LocationType" AS ENUM ('Online', 'Store');
ALTER TABLE "InventoryLocation" ADD COLUMN "locationType" "LocationType" NOT NULL DEFAULT 'Online';
CREATE INDEX "InventoryLocation_shop_locationType_isEnabled_idx" ON "InventoryLocation"("shop", "locationType", "isEnabled");

-- Add SeedingType enum and fields to Seeding
CREATE TYPE "SeedingType" AS ENUM ('Online', 'InStore');
ALTER TABLE "Seeding" ADD COLUMN "seedingType"       "SeedingType" NOT NULL DEFAULT 'Online';
ALTER TABLE "Seeding" ADD COLUMN "storeLocationId"   TEXT;
ALTER TABLE "Seeding" ADD COLUMN "storeLocationName" TEXT;
