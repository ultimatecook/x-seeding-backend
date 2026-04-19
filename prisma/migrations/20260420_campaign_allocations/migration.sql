-- Add startDate and endDate to Campaign
ALTER TABLE "Campaign" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN "endDate" TIMESTAMP(3);

-- Rename maxUnits → allocatedUnits in CampaignProduct
ALTER TABLE "CampaignProduct" RENAME COLUMN "maxUnits" TO "allocatedUnits";

-- Add indexes
CREATE INDEX IF NOT EXISTS "Campaign_shop_idx" ON "Campaign"("shop");
CREATE INDEX IF NOT EXISTS "Campaign_shop_archived_idx" ON "Campaign"("shop", "archived");
CREATE INDEX IF NOT EXISTS "CampaignProduct_campaignId_idx" ON "CampaignProduct"("campaignId");
