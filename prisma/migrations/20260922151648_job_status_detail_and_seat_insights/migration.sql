-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "endCustomerId" TEXT,
ADD COLUMN     "rawStatusName" TEXT;

-- AlterTable
ALTER TABLE "Technician" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "licenseType" TEXT;
