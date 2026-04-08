-- Influencer indexes
CREATE INDEX IF NOT EXISTS "Influencer_archived_idx" ON "Influencer"("archived");
CREATE INDEX IF NOT EXISTS "Influencer_handle_idx" ON "Influencer"("handle");

-- Seeding indexes
CREATE INDEX IF NOT EXISTS "Seeding_shop_idx" ON "Seeding"("shop");
CREATE INDEX IF NOT EXISTS "Seeding_status_idx" ON "Seeding"("status");
CREATE INDEX IF NOT EXISTS "Seeding_influencerId_idx" ON "Seeding"("influencerId");
CREATE INDEX IF NOT EXISTS "Seeding_createdAt_idx" ON "Seeding"("createdAt");
CREATE INDEX IF NOT EXISTS "Seeding_shop_status_idx" ON "Seeding"("shop", "status");
