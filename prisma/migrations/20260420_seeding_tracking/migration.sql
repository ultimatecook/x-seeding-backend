-- Add tracking URL and carrier fields to Seeding
ALTER TABLE "Seeding" ADD COLUMN IF NOT EXISTS "trackingUrl"     TEXT;
ALTER TABLE "Seeding" ADD COLUMN IF NOT EXISTS "trackingCarrier" TEXT;
