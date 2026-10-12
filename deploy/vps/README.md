# Локальный Bot API на VPS (файлы до 2 ГБ)

Схема: Telegram → (вебхук) Worker на Cloudflare → вызовы Bot API и загрузчика идут на `https://$DOMAIN`.
Загрузчик и локальный Bot API на одном VPS, файлы уходят во внутренней сети без лимитов Worker.

## Что нужно заранее
1. VPS (Ubuntu, 2 ГБ ОЗУ, 40 ГБ диска) с Docker и compose.
2. Домен или поддомен, A-запись на IP VPS.
3. `api_id` и `api_hash` с https://my.telegram.org (API development tools).

## Запуск на VPS
```bash
git clone <репо> && cd najdibot/deploy/vps
cp .env.example .env   # заполнить
docker compose up -d --build
```

## Переключение бота (простой около 10 минут)
Бот живёт на одном сервере. После logOut с облачного API на локальный можно войти только через 10 минут.
1. `curl https://api.telegram.org/bot$BOT_TOKEN/logOut`
2. Дождаться 10 минут.
3. Вебхук на локальном сервере: `TG_API=https://$DOMAIN ./set-webhook.sh https://najdibot.mrfilldev.workers.dev`
4. В `wrangler.toml` в `[vars]` добавить `TG_API_URL = "https://$DOMAIN"` и `DOWNLOADER_URL = "https://$DOMAIN"`, затем `npx wrangler deploy`.
5. Проверка: скинуть в чат тяжёлую ссылку, посмотреть `docker compose logs -f downloader`.

## Откат
`curl https://$DOMAIN/bot$BOT_TOKEN/logOut`, убрать две переменные из `wrangler.toml`, задеплоить, выставить вебхук на `api.telegram.org` (`./set-webhook.sh`). Тоже 10 минут простоя.

## Эксплуатация
- Перезапуск загрузчика после обновления кода: `git pull && docker compose up -d --build downloader`.
- Контейнер Cloudflare после переключения не нужен: убрать блок `[[containers]]` из `wrangler.toml`.
