import { ownerId } from './owner.js';
// Куда ходить: по умолчанию облачный Bot API и Cloudflare-контейнер; с TG_API_URL / DOWNLOADER_URL — свой сервер на VPS.

export const tgBase = (env) => (env.TG_API_URL || "https://api.telegram.org").replace(/\/$/, "");

// Запрос к загрузчику: path вроде "/download". На VPS добавляем секрет, в Cloudflare идём через Durable Object.
export async function dl(env, path, init = {}) {
  if (typeof init.body === "string" && ["/download", "/audio", "/dj", "/radio", "/weather"].includes(path)) {
    const body = JSON.parse(init.body);
    init = { ...init, body: JSON.stringify({ ...body, owner_id: await ownerId(env) }) };
  }
  if (env.DOWNLOADER_URL) {
    return fetch(env.DOWNLOADER_URL.replace(/\/$/, "") + path, {
      ...init,
      headers: { ...init.headers, "X-Telegram-Bot-Api-Secret-Token": env.WEBHOOK_SECRET },
    });
  }
  const { getContainer } = await import("@cloudflare/containers"); // лениво: в тестах пакет не грузится
  return getContainer(env.DOWNLOADER).fetch("http://container" + path, init);
}
