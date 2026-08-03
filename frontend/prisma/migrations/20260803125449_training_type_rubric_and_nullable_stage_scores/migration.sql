-- AlterTable
ALTER TABLE "SessionReview" ADD COLUMN     "drillPassed" BOOLEAN,
ALTER COLUMN "contactScore" DROP NOT NULL,
ALTER COLUMN "iceBreakerScore" DROP NOT NULL,
ALTER COLUMN "needsScore" DROP NOT NULL,
ALTER COLUMN "objectionsScore" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TrainingType" ADD COLUMN     "doneWhen" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rubric" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "scoresDeal" BOOLEAN NOT NULL DEFAULT false;
