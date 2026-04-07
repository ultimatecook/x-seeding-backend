-- Create InfluencerSavedSize table
CREATE TABLE "InfluencerSavedSize" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "influencerId" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "size" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InfluencerSavedSize_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer" ("id") ON DELETE CASCADE,
  CONSTRAINT "InfluencerSavedSize_influencerId_category_key" UNIQUE("influencerId", "category")
);

-- Add size and category columns to SeedingProduct
ALTER TABLE "SeedingProduct" ADD COLUMN "size" TEXT,
ADD COLUMN "category" TEXT;

-- Create index for faster lookups
CREATE INDEX "InfluencerSavedSize_influencerId_idx" ON "InfluencerSavedSize"("influencerId");
