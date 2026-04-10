-- CreateTable
CREATE TABLE "PortalUser" (
    "id"            SERIAL NOT NULL,
    "shop"          TEXT NOT NULL,
    "email"         TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "passwordHash"  TEXT,
    "role"          "AppRole" NOT NULL DEFAULT 'Viewer',
    "inviteToken"   TEXT,
    "inviteExpires" TIMESTAMP(3),
    "acceptedAt"    TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalUser_inviteToken_key" ON "PortalUser"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "PortalUser_shop_email_key" ON "PortalUser"("shop", "email");

-- CreateIndex
CREATE INDEX "PortalUser_shop_idx" ON "PortalUser"("shop");

-- CreateIndex
CREATE INDEX "PortalUser_inviteToken_idx" ON "PortalUser"("inviteToken");
