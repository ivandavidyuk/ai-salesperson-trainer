-- Происхождение случая и отметка устаревания.
--
-- diagnosisName/serviceName — то, что генератор возвращал и раньше, а фронт
-- выбрасывал: без них нельзя понять, кого касается правка прайса.
-- staleSince — отметка «этот случай правка задела», ставится в транзакции
-- сохранения формы и снимается удачной пересборкой.
ALTER TABLE "PatientCase" ADD COLUMN "diagnosisName" TEXT;
ALTER TABLE "PatientCase" ADD COLUMN "serviceName" TEXT;
ALTER TABLE "PatientCase" ADD COLUMN "staleSince" TIMESTAMP(3);

-- Бэкфилл: случай, собранный ДО последнего сохранения формы, текущим данным
-- клиники уже не отвечает. Без этой строки клиника с оборванной сборкой
-- вдруг оказалась бы «вся свежая», и недособранные пациенты остались бы
-- с историями чужой отрасли навсегда.
UPDATE "PatientCase" pc
   SET "staleSince" = o."formSavedAt"
  FROM "Organization" o
 WHERE o."id" = pc."organizationId"
   AND o."formSavedAt" IS NOT NULL
   AND pc."generatedAt" < o."formSavedAt";

