-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('Owner', 'Admin', 'Editor', 'Viewer');

-- CreateTable
CREATE TABLE "AppUser" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyUserId" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isShopifyOwner" BOOLEAN NOT NULL DEFAULT false,
    "isShopifyStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppMembership" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "AppRole" NOT NULL DEFAULT 'Viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "highContrast" BOOLEAN NOT NULL DEFAULT false,
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "fontScale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_shop_shopifyUserId_key" ON "AppUser"("shop", "shopifyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_shop_email_key" ON "AppUser"("shop", "email");

-- CreateIndex
CREATE INDEX "AppUser_shop_idx" ON "AppUser"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "AppMembership_shop_userId_key" ON "AppMembership"("shop", "userId");

-- CreateIndex
CREATE INDEX "AppMembership_shop_role_idx" ON "AppMembership"("shop", "role");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- AddForeignKey
ALTER TABLE "AppMembership" ADD CONSTRAINT "AppMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
