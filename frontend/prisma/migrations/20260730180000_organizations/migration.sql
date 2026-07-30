-- Организации: клиника, её отрасль и услуги.
--
-- До этой миграции система была однопользовательской по факту: статистика
-- отдела считалась по всем менеджерам базы, а специализация клиники нигде
-- не хранилась — пациенты были жёстко офтальмологическими.
--
-- User.organizationId делаем nullable намеренно: миграция накатывается
-- на живую базу, где пользователи уже есть. Бэкфилл ниже раскладывает их
-- по одной организации, но само поле остаётся необязательным — иначе
-- следующий созданный руками пользователь уронил бы вставку.
--
-- PatientCase хранит случай под конкретную клинику. Пока записи нет, backend
-- читает Patient.prompt как раньше: это и страховка на выкатку, и рабочий
-- режим для клиник, не заполнивших форму.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizationId" TEXT;
-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "casesTotal" INTEGER NOT NULL DEFAULT 0,
    "casesReady" INTEGER NOT NULL DEFAULT 0,
    "casesUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "PatientCase" (
    "patientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "caseData" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "anamnesis" TEXT NOT NULL,
    "objections" TEXT[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientCase_pkey" PRIMARY KEY ("patientId","organizationId")
);
-- CreateIndex
CREATE INDEX "Service_organizationId_position_idx" ON "Service"("organizationId", "position");
-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PatientCase" ADD CONSTRAINT "PatientCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PatientCase" ADD CONSTRAINT "PatientCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Бэкфилл: одна организация на всех существующих пользователей.
--
-- Название берём из clinic руководителя — единственное место, где оно
-- сегодня записано. Отрасль ставим офтальмологией: именно под неё написаны
-- нынешние пациенты, и любое другое значение было бы неправдой.
--
-- WHERE EXISTS защищает от вставки пустой организации в чистую базу
-- (локальная разработка, тесты): без пользователей она никому не нужна.
INSERT INTO "Organization" ("id", "name", "industry")
SELECT
  gen_random_uuid(),
  COALESCE(
    (SELECT "clinic" FROM "User"
      WHERE "role" = 'head' AND "clinic" IS NOT NULL
      ORDER BY "createdAt" LIMIT 1),
    'Клиника'
  ),
  'офтальмология'
WHERE EXISTS (SELECT 1 FROM "User");

UPDATE "User"
SET "organizationId" = (SELECT "id" FROM "Organization" ORDER BY "createdAt" LIMIT 1)
WHERE "organizationId" IS NULL;
