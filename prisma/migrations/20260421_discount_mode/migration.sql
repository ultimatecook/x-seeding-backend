-- Add discountMode to ShopBilling
-- "simple" = free checkout via applied_discount (default, works on all plans)
-- "analytics" = real Shopify discount codes via /discount/ chain (opt-in)
ALTER TABLE "ShopBilling" ADD COLUMN IF NOT EXISTS "discountMode" TEXT NOT NULL DEFAULT 'simple';
