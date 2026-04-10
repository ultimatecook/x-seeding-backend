-- campaignId index for fast campaign detail page loads
CREATE INDEX IF NOT EXISTS "Seeding_campaignId_idx" ON "Seeding"("campaignId");

-- Compound shop+createdAt for sorted dashboard queries
CREATE INDEX IF NOT EXISTS "Seeding_shop_createdAt_idx" ON "Seeding"("shop", "createdAt" DESC);
