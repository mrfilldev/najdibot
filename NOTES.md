# najdibot: handoff (2026-10-09)
- Состояние: v1 работает. Inline-бот @najdibot отдаёт ссылки поиска (Ozon, WB, Маркет, DNS, Авито, только РФ).
- Стек: Cloudflare Worker (JS, webhook) `worker/index.js`, деплой `npx wrangler deploy`. Секреты BOT_TOKEN и WEBHOOK_SECRET лежат в Worker и в локальном `.env`.
- Webhook ставится `./set-webhook.sh <url>`. Python-версия (aiogram, polling) в `legacy-python/`.
- Решения: JS вместо Python, потому что Workers не умеют polling. Ссылки как HTML-якоря, без голых URL.
- Ловушка: при дописании в `.env` проверять перевод строки в конце.
- Банк идей (terra-incognita/ideas-bank.md): статус «в работе».
- Открыто: v2 (цены/сравнение через Apify или свой парсер, кэш), стоит ли делать, пока не попользовались.
