-- Момент вручения бейджа: плашка в углу и счётчик непросмотренных в меню.

-- Плашку показали и закрыли. Пусто — бейдж стоит в очереди показа.
ALTER TABLE "UserAchievement" ADD COLUMN "shownAt" TIMESTAMP(3);

-- Водяной знак счётчика. Отдельно от shownAt: закрытая плашка не гасит
-- счётчик, иначе «Скрыть все» съедало бы новость, ради которой он и есть.
ALTER TABLE "User" ADD COLUMN "achievementsSeenAt" TIMESTAMP(3);

-- Гасим историю. Без этого 28 уже выданных бейджей высыпались бы стопкой
-- при первом же заходе, а счётчик показал бы «28 новых» на пустом месте.
UPDATE "UserAchievement" SET "shownAt" = "unlockedAt";
UPDATE "User" SET "achievementsSeenAt" = NOW();
