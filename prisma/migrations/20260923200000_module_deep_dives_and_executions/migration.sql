-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "currentStatusType" TEXT,
ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isScheduled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationUid" TEXT,
ADD COLUMN     "priority" TEXT,
ADD COLUMN     "statusHistory" JSONB;

-- AlterTable
ALTER TABLE "EndCustomerLedger" ADD COLUMN     "category" TEXT,
ADD COLUMN     "createdInZuperAt" TIMESTAMP(3),
ADD COLUMN     "organizationUid" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "noOfCustomers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperPropertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationUid" TEXT,
    "state" TEXT,
    "noOfJobs" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperProjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExecutionSnapshot" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "retainedFrom" TIMESTAMP(3),
    "countedFrom" TIMESTAMP(3) NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "medianMs" DOUBLE PRECISION,
    "p90Ms" DOUBLE PRECISION,
    "perWorkflow" JSONB NOT NULL,
    "weekly" JSONB NOT NULL,
    "topErrors" JSONB NOT NULL,
    "errorSampleSize" INTEGER NOT NULL DEFAULT 0,
    "syncRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowExecutionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_customerId_zuperOrganizationId_key" ON "Organization"("customerId", "zuperOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_customerId_zuperPropertyId_key" ON "Property"("customerId", "zuperPropertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_customerId_zuperProjectId_key" ON "Project"("customerId", "zuperProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowExecutionSnapshot_customerId_periodStart_periodEnd_key" ON "WorkflowExecutionSnapshot"("customerId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecutionSnapshot" ADD CONSTRAINT "WorkflowExecutionSnapshot_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

