-- AlterTable
ALTER TABLE "ApiCredential" DROP COLUMN "encryptedApiKey";

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "actionKeys" TEXT[],
ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastExecutionStatus" TEXT,
ADD COLUMN     "lastPublishedAt" TIMESTAMP(3),
ADD COLUMN     "needsAttention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stepCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "triggerKey" TEXT,
ADD COLUMN     "triggerModule" TEXT,
ADD COLUMN     "triggerName" TEXT;

-- CreateTable
CREATE TABLE "JobLineItem" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperJobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productUid" TEXT,
    "name" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "category" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "jobCreatedAt" TIMESTAMP(3) NOT NULL,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "JobLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobLineItem_customerId_jobCreatedAt_idx" ON "JobLineItem"("customerId", "jobCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobLineItem_customerId_zuperJobId_position_key" ON "JobLineItem"("customerId", "zuperJobId", "position");

-- AddForeignKey
ALTER TABLE "JobLineItem" ADD CONSTRAINT "JobLineItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

