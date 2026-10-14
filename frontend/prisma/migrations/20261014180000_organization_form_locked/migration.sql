-- Карточка клиники, закрытая для правки руководителем (Jamaica, 14.10).
-- false у всех существующих: их форма работает как раньше.
ALTER TABLE "Organization" ADD COLUMN "formLocked" BOOLEAN NOT NULL DEFAULT false;
