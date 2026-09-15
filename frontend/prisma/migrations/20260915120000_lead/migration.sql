-- Заявки на демо-доступ с лендинга podhod.tech/start.
-- notifiedAt пустой, пока заявка не дошла до группы в Telegram.
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegram" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "teamSize" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
