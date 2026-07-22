-- CreateEnum
CREATE TYPE "TrainingGroup" AS ENUM ('full', 'stage', 'special');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "prompt" TEXT;

-- CreateTable
CREATE TABLE "TrainingType" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "group" "TrainingGroup" NOT NULL,
    "prompt" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Переименование вместо DROP + ADD: колонка уже могла накопить значения,
-- а имена типов совпадают с будущими id в TrainingType.
ALTER TABLE "Session" RENAME COLUMN "trainingType" TO "trainingTypeId";

-- Типов в таблице ещё нет (их наливает npm run seed:training), поэтому
-- накопленные значения обнуляем — иначе внешний ключ не встанет.
UPDATE "Session" SET "trainingTypeId" = NULL WHERE "trainingTypeId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_trainingTypeId_fkey" FOREIGN KEY ("trainingTypeId") REFERENCES "TrainingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
