// Inline-бот: на @najdibot <запрос> отдаёт ссылки поиска по площадкам.
// Telegram шлёт сюда апдейты вебхуком, мы отвечаем вызовом answerInlineQuery.

// Шаблон: часть до запроса или функция. «yd» = поиск Яндекса по сайту,
// когда нет проверенной ссылки на внутренний поиск.
const yd = (site) => "https://yandex.ru/search/?text=site%3A" + site + "+";

const CATEGORIES = [
  ["Маркетплейсы", [
    ["Ozon", "https://www.ozon.ru/search/?text="],
    ["Wildberries", "https://www.wildberries.ru/catalog/0/search.aspx?search="],
    ["Яндекс Маркет", "https://market.yandex.ru/search?text="],
    ["Мегамаркет", "https://megamarket.ru/catalog/?q="],
    ["AliExpress", "https://aliexpress.ru/wholesale?SearchText="],
    ["Авито", "https://www.avito.ru/rossiya?q="],
  ]],
  ["Электроника", [
    ["DNS", "https://www.dns-shop.ru/search/?q="],
    ["М.Видео", "https://www.mvideo.ru/product-list-page?q="],
    ["Эльдорадо", "https://www.eldorado.ru/search/catalog.php?q="],
    ["Ситилинк", "https://www.citilink.ru/search/?text="],
  ]],
  ["Одежда, красота, дети", [
    ["Lamoda", "https://www.lamoda.ru/catalog/?q="],
    ["Золотое Яблоко", "https://goldapple.ru/catalogsearch/result/?q="],
    ["Спортмастер", "https://www.sportmaster.ru/catalog/?q="],
    ["Детский мир", "https://www.detmir.ru/search/results/?searchTerm="],
  ]],
  ["Дом и ремонт", [
    ["Леруа Мерлен", "https://leroymerlin.ru/search/?q="],
    ["ВсеИнструменты", "https://www.vseinstrumenti.ru/search_main.php?what="],
  ]],
  ["Авто", [
    ["Авторусь", yd("autorus.ru")],
    ["Шинсервис", yd("shinservice.ru")],
    ["Exist", "https://www.exist.ru/Price/?pcode="],
    ["Autodoc", "https://www.autodoc.ru/search?q="],
    ["Autopiter", "https://autopiter.ru/goods/"],
    ["Emex", "https://emex.ru/products/"],
    ["Авито Авто", "https://www.avito.ru/rossiya/avtomobili?q="],
    ["Auto.ru", yd("auto.ru")],
    ["Drom", yd("drom.ru")],
  ]],
];

// «найди <запрос>» — глобальный поиск по мировым площадкам.
const WORLD = [
  ["Весь мир", [
    ["Google", "https://www.google.com/search?q="],
    ["Google Shopping", "https://www.google.com/search?tbm=shop&q="],
    ["Amazon", "https://www.amazon.com/s?k="],
    ["eBay", "https://www.ebay.com/sch/i.html?_nkw="],
    ["AliExpress", "https://www.aliexpress.com/wholesale?SearchText="],
    ["Temu", "https://www.temu.com/search_result.html?search_key="],
    ["Etsy", "https://www.etsy.com/search?q="],
  ]],
];

const flat = (cats) => cats.flatMap(([cat, items]) => items.map(([n, u]) => [n, u, cat]));
const PLATFORMS = CATEGORIES.flatMap(([cat, items]) => items.map(([n, u]) => [n, u, cat]));

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Триггер в чате: сообщение начинается со слова «найдибля», дальше запрос.
const TRIGGER = /^найдибля[\s,:;!.-]*(.{2,})$/is;
const TRIGGER_WORLD = /^найди[\s,:;!.-]+(.{2,})$/is;

// Разбор текста: «найдибля …» — РФ, «найди …» — мир. Возвращает {cats, query} или null.
function parseTrigger(text) {
  let m = text.match(TRIGGER);
  if (m) return { cats: CATEGORIES, query: m[1].trim() };
  m = text.match(TRIGGER_WORLD);
  if (m) return { cats: WORLD, query: m[1].trim() };
  return null;
}

// Запрос с матом: вместо ссылок отвечаем стёбом.
const RUDE = /бля|хуй|хуе|пизд|ебан|ебат|еба[нл]|сука|нахуй/i;
const JOKES = [
  "Такого даже Алиса не найдёт. Даже на Авито.",
  "Wildberries развёл руками, Ozon вызвал охрану, Авито ушёл в запой. Такого в природе нет.",
  "Искал везде. Нашёл только вопросы к тебе.",
  "По этому запросу на Маркете 0 товаров и 1 психолог.",
  "Такое не продают. Такое получают в подарок от жизни.",
  "DNS ответил: «У нас такого нет, и у вас тоже не должно быть».",
  "Нашёл 0 результатов и 1 красный флаг. Красный флаг бесплатно.",
  "Курьер уже выехал, но по дороге передумал и ушёл в монастырь.",
  "Сходи лучше погуляй. Там такого тоже нет, но хотя бы воздух.",
  "На Ozon за этим стоит очередь из 0 человек. И правильно.",
  "Я бот, а не экзорцист. Такое мне искать не по должности.",
  "Результатов: 404. Совести: 404. Вопросов к тебе: много.",
  "Отправил запрос в Wildberries. Они заблокировали мне аккаунт из принципа.",
  "Это не ищется, это лечится. Но я не врач, я бот со ссылками.",
  "Алгоритмы рекомендаций после такого запроса уйдут в отпуск. Минимум на месяц.",
  "Найти могу, но возвращать придётся самому. Причём себе.",
  "На Авито за такое сначала спросят «ещё актуально?», потом пропадут.",
  "Все пять площадок подали заявление на увольнение после твоего запроса.",
  "Даже у Яндекс Маркета есть границы. Ты их нашёл.",
  "Поиск завершён: никто не пострадал, кроме моего самоуважения.",
];

function linksText(query, cats = CATEGORIES) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  return cats.map(([cat, items]) =>
    `<b>${cat}:</b> ` + items.map(([name, base]) => `<a href="${esc(base + q)}">${name}</a>`).join(" · ")
  ).join("\n");
}

function buildResults(query, cats = CATEGORIES) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  return flat(cats).map(([name, base, cat], i) => ({
    type: "article",
    id: String(i),
    title: name,
    description: `${cat}: «${query}»`,
    input_message_content: {
      message_text: `<a href="${esc(base + q)}">${name}: ${esc(query)}</a>`,
      parse_mode: "HTML",
    },
  }));
}

async function reply(env, msg, text) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      reply_parameters: { message_id: msg.message_id },
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
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
      const raw = inline.query.trim();
      const t = parseTrigger(raw);
      const query = t ? t.query : raw;
      const results = query.length < 2 ? [] : buildResults(query, t ? t.cats : CATEGORIES);
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
    const text = msg?.text?.trim();
    const isPrivate = msg?.chat.type === "private";
    if (isPrivate && text && /^\/(start|help)\b/i.test(text)) {
      await reply(env, msg, "Пиши, что искать, и я дам ссылки на Ozon, Wildberries, Маркет, DNS и Авито.\n" +
        "В любом чате работает и так: <code>@najdibot запрос</code>. В группах: <code>найдибля запрос</code> (РФ) или <code>найди запрос</code> (весь мир).");
      return new Response("ok");
    }
    // В личке любой текст — запрос РФ (или «найди …» — мир), в группах нужен триггер.
    const t = text && !text.startsWith("/")
      ? (parseTrigger(text) || (isPrivate ? { cats: CATEGORIES, query: text } : null))
      : null;
    if (t && t.query.length >= 2) {
      const rude = RUDE.test(t.query);
      await reply(env, msg, rude
        ? JOKES[Math.floor(Math.random() * JOKES.length)]
        : `Ищу «${esc(t.query)}»:\n${linksText(t.query, t.cats)}`);
    }
    return new Response("ok");
  },
};
