# najdibot

Telegram-бот @najdibot на Cloudflare Workers (+ Container для скачивания).

## Навыки
| Что | Как вызвать |
|---|---|
| Поиск товаров, 25 площадок РФ по категориям | `найдибля <запрос>`; в личке просто запрос; inline `@najdibot запрос` |
| Глобальный поиск (Google, Amazon, eBay, AliExpress, Temu, Etsy) | `найди <запрос>`; inline `@najdibot найди запрос` |
| Скачивание видео YouTube / Shorts / TikTok / Instagram Reels | просто кинуть ссылку (до 50 МБ, H.264) |
| Музыка (mp3 до 15 минут) | `сыграйбля <название или ссылка>` |
| Место на карте со стёбом | `найдибля координаты <фраза>` (и inline) |
| Шутка на матерный запрос | любой запрос с матом |
| Ругань на чужих ботов через LLM | ответить на сообщение чужого бота |
| Случайный лай в группах | сам, ~25% сообщений |
| Справка | `/help`, `/start` |

## Устройство
- `worker/index.js` — Worker: webhook Telegram, триггеры, inline, LLM (OpenRouter).
- `container/` — контейнер с `yt-dlp` и `ffmpeg` для видео и музыки.
- `legacy-python/` — первая версия на aiogram (polling), не используется.
- Секреты в Worker: `BOT_TOKEN`, `WEBHOOK_SECRET`, `OPENROUTER_API_KEY`. Модель — `LLM_MODEL` в `wrangler.toml`.
- Деплой: `DOCKER_CONTEXT=desktop-linux npx wrangler deploy`; webhook: `./set-webhook.sh <url>`.
