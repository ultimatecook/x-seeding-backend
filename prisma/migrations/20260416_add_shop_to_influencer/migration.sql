-- Add shop column to Influencer for multi-tenant data isolation
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "shop" TEXT NOT NULL DEFAULT '';

-- Backfill: assign each influencer to the shop that has seedings for them
-- COALESCE ensures influencers with no seedings keep '' rather than going NULL
UPDATE "Influencer" i
SET shop = COALESCE(
  (SELECT s.shop FROM "Seeding" s WHERE s."influencerId" = i.id ORDER BY s."createdAt" DESC LIMIT 1),
  ''
)
WHERE shop = '';

-- Add indexes
CREATE INDEX IF NOT EXISTS "Influencer_shop_idx" ON "Influencer"("shop");
CREATE INDEX IF NOT EXISTS "Influencer_shop_archived_idx" ON "Influencer"("shop", "archived");
