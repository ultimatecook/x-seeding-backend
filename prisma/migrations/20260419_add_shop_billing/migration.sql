-- CreateTable: ShopBilling
CREATE TABLE "ShopBilling" (
  "id"              SERIAL NOT NULL,
  "shop"            TEXT NOT NULL,
  "planName"        TEXT NOT NULL DEFAULT 'trial',
  "planStatus"      TEXT NOT NULL DEFAULT 'trial',
  "billingStatus"   TEXT,
  "trialStartedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trialEndsAt"     TIMESTAMP(3) NOT NULL,
  "shopifyChargeId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopBilling_shop_key" ON "ShopBilling"("shop");
CREATE INDEX "ShopBilling_shop_idx" ON "ShopBilling"("shop");
CREATE INDEX "ShopBilling_planStatus_idx" ON "ShopBilling"("planStatus");
