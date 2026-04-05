-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Influencer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Influencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seeding" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "influencerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "trackingNumber" TEXT,
    "notes" TEXT,
    "shippingAddress" TEXT,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shopifyDraftOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Seeding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedingProduct" (
    "id" SERIAL NOT NULL,
    "seedingId" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "SeedingProduct_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Seeding" ADD CONSTRAINT "Seeding_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeedingProduct" ADD CONSTRAINT "SeedingProduct_seedingId_fkey" FOREIGN KEY ("seedingId") REFERENCES "Seeding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
