-- Исход сделки и пятый этап «Закрытие».
--
-- Новые колонки nullable намеренно: у разговоров, разобранных до появления
-- механизма, закрытие не оценивалось и исход не определялся. Ноль и
-- какое-либо значение по умолчанию были бы неправдой — «не измеряли»
-- и «получил ноль» это разные вещи.

CREATE TYPE "DealOutcome" AS ENUM ('paid', 'refused', 'not_asked');

ALTER TABLE "SessionReview"
  ADD COLUMN "closingScore" DOUBLE PRECISION,
  ADD COLUMN "outcome"      "DealOutcome",
  ADD COLUMN "judgeNotes"   TEXT;
