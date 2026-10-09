# najdibot: handoff (2026-10-09, конец сессии)

**Состояние.** @najdibot работает на Cloudflare: Worker (`worker/index.js`, `worker/chat.js`) + Container с yt-dlp/ffmpeg (`container/`) + D1 (память чата). Деплой: `DOCKER_CONTEXT=desktop-linux npx wrangler deploy`. После деплоя живой контейнер остаётся на старом коде: `POST /restart` с `X-Telegram-Bot-Api-Secret-Token`. Полный список навыков: `README.md`, `/help`.

**Решения и грабли.**
- yt-dlp: сначала анонимно, потом с cookies (`runYt`), нужен `--js-runtimes node`. С cookies с IP Cloudflare YouTube даёт 403. Ролики 18+ пока не скачиваются.
- Секреты в Worker: BOT_TOKEN, WEBHOOK_SECRET, OPENROUTER_API_KEY, YT_COOKIES_GZB64. Локально в `.env` (не в git). Дописывая в `.env`, проверять перевод строки.
- Озвучка OpenAI (`gpt-audio-mini`) мат пропускает. Для мата нужен Silero (локально). Рецепт голоса №3: `docs/voice-recipe.md`, `tools/voice/`. В бота НЕ подключён.
- Cron сводки: 15:00 и 21:00 UTC (18:00 и 00:00 МСК), `/сводка` по запросу.
- Групповая память: 300 сообщений на чат, `/forget` стирает свои. Чат об этом предупреждён автором.

**Открыто.** Модерация (бот не админ, нет /mute /ban /warn, проверки админа), приветствие и капча новичкам, настройки по чату (шансы и функции зашиты в код), подключение голоса Silero к боту, ролики 18+.
