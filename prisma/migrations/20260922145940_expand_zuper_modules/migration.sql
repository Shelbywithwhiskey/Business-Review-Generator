/*
  Warnings:

  - You are about to drop the column `method` on the `Payment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "invoiceNo" INTEGER,
ADD COLUMN     "isPaid" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "method",
ADD COLUMN     "actionModule" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "paymentModeName" TEXT,
ADD COLUMN     "paymentModeType" TEXT,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "zuperInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "Technician" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "hourlyRate" DECIMAL(10,2),
ADD COLUMN     "hoursWorked" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperQuoteId" TEXT NOT NULL,
    "quoteNo" INTEGER,
    "status" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isConverted" BOOLEAN NOT NULL DEFAULT false,
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "estimateAt" TIMESTAMP(3) NOT NULL,
    "expiryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperProductId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lowStock" BOOLEAN NOT NULL DEFAULT false,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperExpenseId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "description" TEXT,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperTimesheetId" TEXT NOT NULL,
    "zuperUserId" TEXT NOT NULL,
    "userName" TEXT,
    "typeOfCheck" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "TimesheetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndCustomerLedger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "zuperCustomerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "noOfJobs" INTEGER NOT NULL DEFAULT 0,
    "ltv" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "receivables" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "EndCustomerLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_customerId_estimateAt_idx" ON "Quote"("customerId", "estimateAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_customerId_zuperQuoteId_key" ON "Quote"("customerId", "zuperQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_customerId_zuperProductId_key" ON "Product"("customerId", "zuperProductId");

-- CreateIndex
CREATE INDEX "Expense_customerId_incurredAt_idx" ON "Expense"("customerId", "incurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_customerId_zuperExpenseId_key" ON "Expense"("customerId", "zuperExpenseId");

-- CreateIndex
CREATE INDEX "TimesheetEvent_customerId_zuperUserId_checkedAt_idx" ON "TimesheetEvent"("customerId", "zuperUserId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetEvent_customerId_zuperTimesheetId_key" ON "TimesheetEvent"("customerId", "zuperTimesheetId");

-- CreateIndex
CREATE UNIQUE INDEX "EndCustomerLedger_customerId_zuperCustomerId_key" ON "EndCustomerLedger"("customerId", "zuperCustomerId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEvent" ADD CONSTRAINT "TimesheetEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndCustomerLedger" ADD CONSTRAINT "EndCustomerLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
