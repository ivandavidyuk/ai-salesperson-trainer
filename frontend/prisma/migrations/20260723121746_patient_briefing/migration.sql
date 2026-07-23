-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "approach" TEXT,
ADD COLUMN     "character" TEXT,
ADD COLUMN     "decisionMaker" TEXT,
ADD COLUMN     "objections" TEXT[];
