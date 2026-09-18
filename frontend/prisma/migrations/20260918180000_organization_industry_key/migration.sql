-- Отрасль организации — отдельным полем, а не угадыванием по тексту.
-- Разметка существующих — той же проверкой, что работала до поля
-- (industryKey во frontend, industry_key в backend): поведение ни у кого
-- не меняется. На проде 18.09 «недвижимость» получает одна организация —
-- «Пресет · Недвижимость», остальные одиннадцать — «медицина».
ALTER TABLE "Organization" ADD COLUMN "industryKey" TEXT NOT NULL DEFAULT 'медицина';
UPDATE "Organization" SET "industryKey" = 'недвижимость'
  WHERE "industry" ~* '(недвиж|застройщ|офис продаж)';
