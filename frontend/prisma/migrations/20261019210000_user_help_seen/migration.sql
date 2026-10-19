-- Когда человек открыл шпаргалку /help или закрыл объявление о ней
ALTER TABLE "User" ADD COLUMN     "helpSeenAt" TIMESTAMP(3);
