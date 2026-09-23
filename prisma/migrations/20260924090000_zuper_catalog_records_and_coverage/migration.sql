-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "extra" JSONB;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentType" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "ZuperRecord" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "recordUid" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "recordCreatedAt" TIMESTAMP(3),
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "ZuperRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleCoverage" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "totalRecords" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "fieldStats" JSONB,
    "message" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "ModuleCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZuperRecord_customerId_module_recordCreatedAt_idx" ON "ZuperRecord"("customerId", "module", "recordCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ZuperRecord_customerId_module_recordUid_key" ON "ZuperRecord"("customerId", "module", "recordUid");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleCoverage_customerId_module_key" ON "ModuleCoverage"("customerId", "module");

-- AddForeignKey
ALTER TABLE "ZuperRecord" ADD CONSTRAINT "ZuperRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleCoverage" ADD CONSTRAINT "ModuleCoverage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

