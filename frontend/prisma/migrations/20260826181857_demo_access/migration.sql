-- Демо-доступ на сутки и отраслевые пресеты.
-- isDemo: организация выдана после демо-звонка, разговоры закрываются
--   через сутки после первого (момент — в demoExpiresAt), вход и разборы
--   живут ещё неделю.
-- demoExpiresAt: null у демо = разговор ещё не начинали, сутки не тикают.
-- isPreset: шаблонная организация с вычитанными случаями; пользователей
--   не имеет, из неё копируются PatientCase при выдаче демо той же отрасли.
ALTER TABLE "Organization"
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "demoExpiresAt" TIMESTAMP(3),
  ADD COLUMN "isPreset" BOOLEAN NOT NULL DEFAULT false;
