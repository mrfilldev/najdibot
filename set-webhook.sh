#!/bin/sh
# Использование: ./set-webhook.sh https://najdibot.<аккаунт>.workers.dev
# Для локального Bot API: TG_API=https://bot.example.com ./set-webhook.sh <url>
# Нужны BOT_TOKEN и WEBHOOK_SECRET в .env
set -a; . ./.env; set +a
curl -s "${TG_API:-https://api.telegram.org}/bot$BOT_TOKEN/setWebhook" \
  --data-urlencode "url=$1" \
  --data-urlencode "secret_token=$WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["inline_query","message","callback_query"]'
echo
