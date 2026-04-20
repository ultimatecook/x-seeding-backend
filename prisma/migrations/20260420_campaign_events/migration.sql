-- Add event fields to Campaign
ALTER TABLE "Campaign" ADD COLUMN "type"          TEXT NOT NULL DEFAULT 'seeding';
ALTER TABLE "Campaign" ADD COLUMN "eventDate"     TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN "eventLocation" TEXT;

CREATE INDEX IF NOT EXISTS "Campaign_shop_type_idx" ON "Campaign"("shop", "type");

-- Guest list for event campaigns
CREATE TABLE "CampaignGuest" (
  "id"           SERIAL       PRIMARY KEY,
  "campaignId"   INTEGER      NOT NULL,
  "influencerId" INTEGER,
  "name"         TEXT         NOT NULL,
  "email"        TEXT,
  "status"       TEXT         NOT NULL DEFAULT 'invited',
  "seedingId"    INTEGER,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignGuest_campaignId_fkey"   FOREIGN KEY ("campaignId")   REFERENCES "Campaign"("id")   ON DELETE CASCADE,
  CONSTRAINT "CampaignGuest_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL
);

CREATE INDEX "CampaignGuest_campaignId_idx"   ON "CampaignGuest"("campaignId");
CREATE INDEX "CampaignGuest_influencerId_idx" ON "CampaignGuest"("influencerId");

-- Items assigned to each guest (products they should receive)
CREATE TABLE "GuestItem" (
  "id"          SERIAL           PRIMARY KEY,
  "guestId"     INTEGER          NOT NULL,
  "productId"   TEXT             NOT NULL,
  "productName" TEXT             NOT NULL,
  "imageUrl"    TEXT,
  "price"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "quantity"    INTEGER          NOT NULL DEFAULT 1,
  "fulfilled"   BOOLEAN          NOT NULL DEFAULT false,
  CONSTRAINT "GuestItem_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "CampaignGuest"("id") ON DELETE CASCADE
);

CREATE INDEX "GuestItem_guestId_idx" ON "GuestItem"("guestId");
