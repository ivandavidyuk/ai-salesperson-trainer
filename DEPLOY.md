# Деплой на Yandex Cloud

Инструкция по развёртыванию голосового ИИ-тренажёра на одной виртуальной
машине Yandex Compute Cloud. Весь стек (Next.js, FastAPI, PostgreSQL, Redis)
поднимается через Docker Compose за реверс-прокси **Caddy** с автоматическим
HTTPS/WSS (Let's Encrypt).

> **Почему именно так.** Для MVP на одного-двух тестировщиков одна VM —
> самый простой и дешёвый вариант. WebSocket-пайплайн требует долгоживущих
> соединений, поэтому serverless-контейнеры не подходят. HTTPS обязателен:
> без него браузер не даст доступ к микрофону. VM в Yandex Cloud расположена
> рядом со SpeechKit → низкая задержка.

---

## Рекомендуемая конфигурация сервера

- **Сервис:** Yandex Compute Cloud (виртуальная машина)
- **ОС:** Ubuntu 22.04 LTS
- **vCPU / RAM:** 2 vCPU (можно 50–100% гарантированной доли) / 4 ГБ
- **Диск:** 20–30 ГБ SSD
- **Публичный IP:** нужен (статический — удобнее для DNS)
- **Порты (security group / firewall):** 22 (SSH), 80 и 443 (HTTP/HTTPS)

Для роста в будущем: вынести БД в **Managed Service for PostgreSQL** и Redis в
**Managed Service for Valkey/Redis**, приложения оставить на VM. Пока не нужно.

---

## Предварительно

1. **Домен.** Заведи A-запись (например `trainer.example.com`), указывающую на
   публичный IP VM. Без домена Let's Encrypt не выдаст сертификат.
2. **Ключ Yandex Cloud** для SpeechKit + YandexGPT (`YANDEX_API_KEY`,
   `YANDEX_FOLDER_ID`) — те же, что использовались локально.

---

## Шаг 1. Установить Docker на VM

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER   # затем перелогиниться (exit + ssh снова)
```

## Шаг 2. Получить код

```bash
git clone <URL-репозитория> ai-salesperson-trainer
cd ai-salesperson-trainer
```

## Шаг 3. Заполнить переменные окружения

Сгенерируй общий секрет JWT (используется и во фронтенде, и в бэкенде):

```bash
openssl rand -base64 48
```

Создай три файла из шаблонов и заполни значения:

```bash
# 1) Переменные compose (домен, email, пароль БД)
cp .env.prod.example .env

# 2) Next.js
cp frontend/.env.production.example frontend/.env

# 3) FastAPI
cp backend/.env.production.example backend/.env
```

Проверь, что согласованы значения:

| Значение | Где должно совпадать |
|---|---|
| `POSTGRES_PASSWORD` (в `.env`) | пароль внутри `DATABASE_URL` в `frontend/.env` и `backend/.env` |
| `JWT_SECRET` | одинаковый в `frontend/.env` и `backend/.env` |
| `DOMAIN` (в `.env`) | тот же домен в `FASTAPI_WS_URL=wss://<domain>` в `frontend/.env` |

Заполни в `backend/.env` ключи `YANDEX_API_KEY` и `YANDEX_FOLDER_ID`.

## Шаг 4. Запустить

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Что произойдёт:
- поднимутся PostgreSQL и Redis (данные в именованных volume);
- фронтенд при старте применит миграции Prisma (`prisma migrate deploy`);
- Caddy автоматически получит TLS-сертификат для `DOMAIN` и включит HTTPS/WSS.

Проверить статус и логи:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy      # выдача сертификата
docker compose -f docker-compose.prod.yml logs -f frontend   # миграции/сервер
```

## Шаг 5. Создать пользователя для тестировщика

```bash
docker compose -f docker-compose.prod.yml exec frontend npx ts-node create-user.ts
```

Скрипт спросит email, пароль и имя.

## Шаг 6. Проверить

Открой `https://<domain>`, войди созданными данными, нажми «Начать разговор»,
разреши доступ к микрофону и проговори фразу. Должен прийти голосовой ответ.

---

## Обновление после изменений в коде

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Полезные команды

```bash
# перезапустить только бэкенд
docker compose -f docker-compose.prod.yml restart backend

# остановить всё (данные сохраняются)
docker compose -f docker-compose.prod.yml down

# остановить и удалить данные БД (осторожно!)
docker compose -f docker-compose.prod.yml down -v
```

---

## Чек-лист безопасности

- `.env`, `frontend/.env`, `backend/.env` **не** коммитятся (в `.gitignore`).
- `JWT_SECRET` — длинный случайный, не из примера.
- `POSTGRES_PASSWORD` — сильный, не из примера.
- Порт PostgreSQL/Redis наружу **не** публикуется (доступ только внутри
  compose-сети). Наружу открыт только Caddy (80/443).
- Куки выставляются с флагом `Secure` в продакшене (работает только по HTTPS).
