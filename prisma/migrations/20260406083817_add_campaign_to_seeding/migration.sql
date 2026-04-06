-- AlterTable
ALTER TABLE "Seeding" ADD COLUMN     "campaignId" INTEGER;

-- AddForeignKey
ALTER TABLE "Seeding" ADD CONSTRAINT "Seeding_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
