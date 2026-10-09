// Inline-бот: на @najdibot <запрос> отдаёт ссылки поиска по площадкам.
// Telegram шлёт сюда апдейты вебхуком, мы отвечаем вызовом answerInlineQuery.

const PLATFORMS = [
  ["Ozon", "https://www.ozon.ru/search/?text="],
  ["Wildberries", "https://www.wildberries.ru/catalog/0/search.aspx?search="],
  ["Яндекс Маркет", "https://market.yandex.ru/search?text="],
  ["DNS", "https://www.dns-shop.ru/search/?q="],
  ["Авито", "https://www.avito.ru/rossiya?q="],
];

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Триггер в чате: сообщение начинается со слова «найдибля», дальше запрос.
const TRIGGER = /^найдибля[\s,:;!.-]*(.{2,})$/is;

// Запрос с матом: вместо ссылок отвечаем стёбом.
const RUDE = /бля|хуй|хуе|пизд|ебан|ебат|еба[нл]|сука|нахуй/i;
const JOKES = [
  "Такого даже Алиса не найдёт. Даже на Авито.",
  "Wildberries развёл руками, Ozon вызвал охрану, Авито ушёл в запой. Такого в природе нет.",
  "Искал везде. Нашёл только вопросы к тебе.",
  "По этому запросу на Маркете 0 товаров и 1 психолог.",
  "Такое не продают. Такое получают в подарок от жизни.",
];

function linksText(query) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  return PLATFORMS.map(([name, base]) => `<a href="${esc(base + q)}">${name}</a>`).join(" · ");
}

function buildResults(query) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  return PLATFORMS.map(([name, base], i) => ({
    type: "article",
    id: String(i),
    title: name,
    description: `Искать «${query}»`,
    input_message_content: {
      message_text: `<a href="${esc(base + q)}">${name}: ${esc(query)}</a>`,
      parse_mode: "HTML",
    },
  }));
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok");
    // Telegram присылает наш секрет в заголовке; чужие запросы отбрасываем.
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const update = await request.json();
    const inline = update.inline_query;
    if (inline) {
      const query = inline.query.trim();
      const results = query.length < 2 ? [] : buildResults(query);
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerInlineQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inline_query_id: inline.id,
          results,
          cache_time: results.length ? 300 : 1,
        }),
      });
    }

    const msg = update.message;
    const m = msg?.text && msg.text.trim().match(TRIGGER);
    if (m) {
      const query = m[1].trim();
      const rude = RUDE.test(query);
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          reply_parameters: { message_id: msg.message_id },
          text: rude
            ? JOKES[Math.floor(Math.random() * JOKES.length)]
            : `Ищу «${esc(query)}»:\n${linksText(query)}`,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
      });
    }
    return new Response("ok");
  },
};
