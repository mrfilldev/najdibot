#!/bin/sh
# Использование: ./set-cookies.sh путь/к/cookies.txt
# Сжимает cookies.txt и кладёт секретом YT_COOKIES_GZB64 в Worker (содержимое не печатается).
set -e
gzip -9c "$1" | base64 | tr -d '\n' | npx wrangler secret put YT_COOKIES_GZB64
