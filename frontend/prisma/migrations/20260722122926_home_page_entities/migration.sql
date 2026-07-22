/*
  Warnings:

  - You are about to drop the column `name` on the `User` table. All the data in the column will be lost.
  - Added the required column `firstName` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DailyContentKind" AS ENUM ('tip', 'motivation');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "patientId" TEXT,
ADD COLUMN     "topic" TEXT;

-- AlterTable
-- Поле name заменяется на firstName + lastName.
-- Колонки добавляем с временным дефолтом и сразу его снимаем: иначе
-- NOT NULL без значения не применился бы к непустой таблице (на проде
-- есть тестовые аккаунты). Разбирать старое name на части не нужно —
-- аккаунты одноразовые и пересоздаются скриптами после миграции.
ALTER TABLE "User" DROP COLUMN "name",
ADD COLUMN     "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastName" TEXT NOT NULL DEFAULT '';

ALTER TABLE "User" ALTER COLUMN "firstName" DROP DEFAULT,
                   ALTER COLUMN "lastName" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionReview" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "contactScore" DOUBLE PRECISION NOT NULL,
    "iceBreakerScore" DOUBLE PRECISION NOT NULL,
    "needsScore" DOUBLE PRECISION NOT NULL,
    "objectionsScore" DOUBLE PRECISION NOT NULL,
    "strength" TEXT NOT NULL,
    "growthPoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyContent" (
    "id" TEXT NOT NULL,
    "kind" "DailyContentKind" NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionReview_sessionId_key" ON "SessionReview"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyContent_kind_position_key" ON "DailyContent"("kind", "position");

-- CreateIndex
CREATE INDEX "Session_userId_startedAt_idx" ON "Session"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionReview" ADD CONSTRAINT "SessionReview_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
