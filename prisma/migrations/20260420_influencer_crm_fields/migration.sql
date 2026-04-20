-- Add CRM profile fields to Influencer
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "city"                   TEXT;
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "gender"                 TEXT;
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "phone"                  TEXT;
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "defaultShippingAddress" TEXT;
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "shippingNotes"          TEXT;
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "styleTags"              TEXT;
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "productPreferences"     TEXT;
