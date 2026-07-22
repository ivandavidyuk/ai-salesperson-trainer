-- CreateEnum
CREATE TYPE "PatientDifficulty" AS ENUM ('easy', 'mid', 'hard');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "difficulty" "PatientDifficulty" NOT NULL DEFAULT 'mid';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "trainingType" TEXT;
