-- Результат диагностики во время разговора.
-- diagnosticsResult: документ, сгенерированный на старте полного разговора,
--   свой на каждую сессию. diagnosticsShownAt: момент показа менеджеру;
--   null = кнопку не нажимали, в расшифровке вставлять нечего.
ALTER TABLE "Session"
  ADD COLUMN "diagnosticsResult" TEXT,
  ADD COLUMN "diagnosticsShownAt" TIMESTAMP(3);
