-- Рубрика и критерий упражнения по отрасли — как сцена в promptByIndustry.
-- У клиники «поздоровались у стойки, по дороге в кабинет», «анамнез
-- и диоптрии»; оценщик офиса продаж судил бы по этому упражнение, в котором
-- был стол переговоров. Пусто — базовый текст словами отрасли.
ALTER TABLE "TrainingType" ADD COLUMN "rubricByIndustry" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "TrainingType" ADD COLUMN "doneWhenByIndustry" JSONB NOT NULL DEFAULT '{}';
