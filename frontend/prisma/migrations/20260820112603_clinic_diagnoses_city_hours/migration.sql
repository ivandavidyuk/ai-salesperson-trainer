-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "city" TEXT,
ADD COLUMN     "hoursLimit" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "statsResetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "complaint" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Diagnosis_organizationId_position_idx" ON "Diagnosis"("organizationId", "position");

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
