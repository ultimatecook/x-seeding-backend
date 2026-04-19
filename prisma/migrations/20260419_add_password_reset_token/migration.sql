-- AlterTable: add password reset token fields to PortalUser
ALTER TABLE "PortalUser" ADD COLUMN "resetToken" TEXT;
ALTER TABLE "PortalUser" ADD COLUMN "resetTokenExpires" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PortalUser_resetToken_key" ON "PortalUser"("resetToken");
CREATE INDEX "PortalUser_resetToken_idx" ON "PortalUser"("resetToken");
