-- Add cost per unit (Shopify COGS) to SeedingProduct
ALTER TABLE "SeedingProduct" ADD COLUMN "cost" DOUBLE PRECISION;
