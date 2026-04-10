-- CreateTable
CREATE TABLE "AuditLog" (
    "id"           SERIAL NOT NULL,
    "shop"         TEXT NOT NULL,
    "portalUserId" INTEGER NOT NULL,
    "userName"     TEXT NOT NULL,
    "userEmail"    TEXT NOT NULL,
    "userRole"     "AppRole" NOT NULL,
    "action"       TEXT NOT NULL,
    "entityType"   TEXT NOT NULL,
    "entityId"     INTEGER,
    "detail"       TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_shop_idx" ON "AuditLog"("shop");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
