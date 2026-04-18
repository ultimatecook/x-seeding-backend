-- Add LocationType enum (idempotent)
DO $$ BEGIN
  CREATE TYPE "LocationType" AS ENUM ('Online', 'Store');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add SeedingType enum (idempotent)
DO $$ BEGIN
  CREATE TYPE "SeedingType" AS ENUM ('Online', 'InStore');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add locationType to InventoryLocation
ALTER TABLE "InventoryLocation" ADD COLUMN IF NOT EXISTS "locationType" "LocationType" NOT NULL DEFAULT 'Online';

-- Add index for locationType
CREATE INDEX IF NOT EXISTS "InventoryLocation_shop_locationType_isEnabled_idx" ON "InventoryLocation"("shop", "locationType", "isEnabled");

-- Add seedingType and store fields to Seeding
ALTER TABLE "Seeding" ADD COLUMN IF NOT EXISTS "seedingType"       "SeedingType" NOT NULL DEFAULT 'Online';
ALTER TABLE "Seeding" ADD COLUMN IF NOT EXISTS "storeLocationId"   TEXT;
ALTER TABLE "Seeding" ADD COLUMN IF NOT EXISTS "storeLocationName" TEXT;
