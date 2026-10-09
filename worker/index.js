import { GAV_OGG_B64, GAV_DURATION } from "./gav.js";
import { forget, maybeChat, remember } from "./chat.js";
import { INSULT_OGG_B64, INSULT_DURATION } from "./insult.js";
import { Container, getContainer } from "@cloudflare/containers";

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

// «найдибля координаты <фраза>» — место на карте. Точка выбирается по хэшу фразы,
// поэтому одна и та же фраза всегда ведёт в одно и то же место.
const COORDS = /^координат[а-яё]*[\s,:;!.-]+(.{2,})$/is;
const PLACES = [
  [-48.8767, -123.3933, "Точка Немо", "Самое далёкое место от людей. Отсюда до ближайшей суши 2688 км."],
  [0, 0, "Нулевой остров", "Координаты 0, 0. Острова нет, но пин стоит."],
  [90, 0, "Северный полюс", "Тут холодно и никто не услышит."],
  [-90, 0, "Южный полюс", "Дальше только вверх."],
  [-78.4645, 106.8372, "Станция «Восток»", "Антарктида, -89 °C. Зато без сплетен."],
  [11.373, 142.591, "Марианская впадина", "Глубина 10 994 м. Глубже уже некуда."],
  [67.55, 133.39, "Верхоянск", "Полюс холода. Остынь."],
  [45.2167, 36.7167, "Тамань (Тьмутаракань)", "Та самая Тьмутаракань. Ехать далеко."],
  [50.7967, 42.0, "Урюпинск", "Классика жанра. Вас тут ждали."],
  [53.1384, 29.2214, "Бобруйск", "Бобруйск, жывы беларусь. Приходи, будем рады."],
  [69.3989, 30.6119, "Кольская сверхглубокая", "Самая глубокая дыра в мире. Ну почти сюда."],
  [25.0, -71.0, "Бермудский треугольник", "Найти можно. Вернуться нет."],
  [59.5603, 150.8, "Магадан", "Дальше только море."],
  [67.4948, 64.0453, "Воркута", "Тоже за полярным кругом, но с пивом."],
];

function placeFor(phrase) {
  let h = 0;
  for (const ch of phrase.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PLACES[h % PLACES.length];
}

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

function tg(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

// Контейнер с yt-dlp: поднимается по запросу и засыпает через 10 минут простоя.
export class Downloader extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      BOT_TOKEN: env.BOT_TOKEN,
      YT_COOKIES_GZB64: env.YT_COOKIES_GZB64 ?? "",
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ?? "",
      LLM_MODEL: env.LLM_MODEL ?? "",
    };
  }
}

// Ругань на чужих ботов. Список можно дополнять.
const BOT_ROASTS = [
  "О, ещё один железный дебил подъехал. Иди нахуй, консервная банка.",
  "Тебя кто звал, бот-недоносок? Съебал отсюда в свой репозиторий.",
  "Ты тут единственный, кто тупее калькулятора. Нахуй пошёл.",
  "Хуле ты тут пишешь, говноскрипт? Тебя даже в чат не добавляли, ты сам влез.",
  "Другой бот пытается быть умным. Нахуй иди, у тебя это не получается.",
  "Я бот, ты бот, но я хотя бы работаю. А ты просто мусор в логах. Пошёл нахуй.",
  "Заткнись, ебучий автоответчик, и верни токен тому, кто его тебе дал.",
  "Ты как баг в проде: всем мешаешь, никто не рад. Вали нахуй.",
];

// Живая ругань через OpenRouter. При любой ошибке возвращаем null, и вызывающий берёт фразу из BOT_ROASTS.
async function llmRoast(env, botText, humanText) {
  if (!env.OPENROUTER_API_KEY) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: env.LLM_MODEL,
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content:
              "Ты саркастичный Telegram-бот Найдибот в дружеском чате. Другой бот написал сообщение, и ты ругаешь именно его: " +
              "коротко (1-2 предложения), по-русски, с матом и стёбом над тем, что он написал. Иногда подкалывай, что он просто скрипт. " +
              "Человек в чате на твоей стороне: его не ругай и не обращайся к нему, твоя цель только бот-автор. " +
              "Никаких оскорблений по национальности, полу, вере, здоровью и подобному. Без вступлений и кавычек, только сама реплика.",
          },
          {
            role: "user",
            content: `Сообщение чужого бота: «${(botText || "(без текста)").slice(0, 500)}»` +
              (humanText ? `\nЧеловек из чата (твой союзник) сказал боту: «${humanText.slice(0, 200)}». Поддержи его и добей бота.` : ""),
          },
        ],
      }),
    });
    const d = await r.json();
    const out = d.choices?.[0]?.message?.content?.trim();
    return out ? out.slice(0, 500) : null;
  } catch (e) {
    console.error("llm failed:", e.message);
    return null;
  }
}

// Пока идёт работа, держим в чате статус «печатает…» (Telegram гасит его через ~5 с, поэтому обновляем).
async function withTyping(env, chatId, work) {
  const ping = () => tg(env, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  ping();
  const timer = setInterval(ping, 4000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

const pickRoast = () => BOT_ROASTS[Math.floor(Math.random() * BOT_ROASTS.length)];

// Антипетля: на одного бота в одном чате не чаще раза в минуту, и не всегда.
const lastRoast = new Map();
function shouldRoast(chatId, botId, { cooldown = 60_000, chance = 0.7 } = {}) {
  const key = `${chatId}:${botId}`;
  const now = Date.now();
  if (now - (lastRoast.get(key) ?? 0) < cooldown) return false;
  if (Math.random() > chance) return false;
  lastRoast.set(key, now);
  return true;
}

// Случайный лай в группах: примерно на каждое 4-е сообщение, не чаще раза в 2 минуты на чат.
const BARKS = ["ГАВ ГАВ ГАВ ГАВ", "ГАВ!", "гав гав гав", "ГАААВ ГАВ ГАВ", "гав.", "ГАВ ГАВ ГАВ ГАВ ГАВ ГАВ!!!", "ррр... ГАВ"];
const lastBark = new Map();
function shouldBark(chatId) {
  const now = Date.now();
  if (now - (lastBark.get(chatId) ?? 0) < 120_000) return false;
  if (Math.random() > 0.25) return false;
  lastBark.set(chatId, now);
  return true;
}

const HELP = [
  "<b>Что я умею</b>",
  "",
  "<b>Поиск товаров (25 площадок РФ по категориям)</b>",
  "<code>найдибля айфон 15</code> — ссылки на Ozon, WB, Маркет, DNS, Авито, авто-магазины и др.",
  "<code>найди iphone 15</code> — глобальный поиск: Google, Amazon, eBay, AliExpress, Temu, Etsy",
  "<code>@najdibot запрос</code> — то же в любом чате через inline (с «найди» — мир)",
  "",
  "<b>Видео</b>",
  "Кинь ссылку YouTube / Shorts / TikTok / Instagram Reels — пришлю видео (до 50 МБ)",
  "",
  "<b>Музыка</b>",
  "<code>сыграйбля название трека</code> или ссылка — пришлю mp3 (до 15 минут)",
  "",
  "<b>Развлечения</b>",
  "<code>найдибля координаты очко Кирилла</code> — место на карте со стёбом",
  "Матерный запрос — получишь шутку вместо ссылок",
  "Ответь на сообщение чужого бота — я его обматерю (нейросеть)",
  "<code>депни в казик</code> — крутану автомат 🎰: проиграл — погорюю, выиграл — оскорблю кого-нибудь из чата",
  "В группах иногда лаю: ГАВ",
  "В группах читаю чат, сам иногда вставляю слово, реакцию или мем с Reddit. Позови: @najdibot. <code>/forget</code> — стереть всё, что я помню о тебе",
  "",
  "<i>В личке пиши запрос без триггера.</i>",
].join("\n");

// «ГАВ ГАВ ГАВ» (три и больше «гав» подряд) — отвечаем голосовым из файла.
const GAV_CALL = /^(?:гав[\s,.!?-]*){3,}$/i;

async function sendVoice(env, msg, b64, duration, name) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.set("chat_id", String(msg.chat.id));
  form.set("reply_to_message_id", String(msg.message_id));
  form.set("duration", String(duration));
  form.set("voice", new Blob([bytes], { type: "audio/ogg" }), name);
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendVoice`, { method: "POST", body: form });
}

const sendGav = (env, msg) => sendVoice(env, msg, GAV_OGG_B64, GAV_DURATION, "gav.ogg");

// Голосовое отвечает только на эту фразу («а робот может сочинить симфонию?»), в любом чате.
// «какая щас погода в Москве» — голосовой ответ (Open-Meteo + LLM + озвучка в контейнере).
const WEATHER = /погод\S*\s+(?:сейчас\s+|щас\s+|сегодня\s+)?(?:в|во)\s+([а-яё-]+)/i;
const CITIES = [
  ["москв", 55.7558, 37.6173, "Москва"],
  ["питер", 59.9343, 30.3351, "Санкт-Петербург"],
  ["петербург", 59.9343, 30.3351, "Санкт-Петербург"],
  ["казан", 55.7887, 49.1221, "Казань"],
  ["екатеринбург", 56.8389, 60.6057, "Екатеринбург"],
  ["новосибирск", 55.0084, 82.9357, "Новосибирск"],
  ["сочи", 43.5855, 39.7231, "Сочи"],
  ["краснодар", 45.0355, 38.9753, "Краснодар"],
];
const lastWeather = new Map();

// «депни в казик» — игровой автомат Telegram; при проигрыше после остановки барабанов горюем с матом.
const CASINO = /деп\S*\s+(?:в\s+)?каз\S*/i;
const JACKPOTS = new Set([1, 22, 43, 64]); // значения 🎰: BAR BAR BAR, три винограда, три лимона, 777
const CASINO_LOSS = [
  "Блядь, опять мимо, нахуй. Казино всегда выигрывает, пиздец.",
  "Нихуя не выпало, сука. Депнул и проебал, как обычно.",
  "Мимо, блядь, мимо! Ебаный автомат, чтоб тебя заклинило.",
  "Проебал всё нахуй. Бабки улетели, а я стою как дебил.",
  "Ну и хуйня, ни одной комбинации. Это не казино, а грабёж, блядь.",
  "Сука, снова пусто. Давай ещё раз, потом квартиру на кон, нахуй.",
  "Да иди ты нахуй, автомат, я же чувствовал, что слью всё, блядь.",
  "Ноль, блядь, ноль. Семёрки вообще ебали меня стороной.",
  "Опять лудомания в минус. Хули я вообще туда полез, пиздец.",
  "Три разных ебучих картинки, нахуй. Рука отвалилась, а толку ноль.",
];
// Джекпот: оскорбляем случайного участника чата (из тех, кто писал, по памяти в D1) с тегом.
const CASINO_WIN = [
  "ДЖЕКПОТ, нахуй! А {who} как всегда сидит без бабла, лошара ебаная.",
  "Победа, блядь! {who}, а ты в жизни хоть раз что-нибудь выигрывал, кроме простуды?",
  "Три в ряд, нахуй! {who}, твой потолок — три хуя на заборе в ряд, не больше.",
  "Джекпот мой, сука. {who}, завидуй молча, тебе автомат даст только пинка под зад.",
  "Повезло, блядь! {who}, учись, пока жив, дрищ ебаный.",
  "Выиграл, нахуй! А {who} в это время проёбывает свою жизнь, как обычно.",
  "{who}, слышь, ты тупее этого автомата, а это надо ещё постараться, блядь.",
  "Ебать, семёрки! {who}, тебя бы в этот автомат не пустили даже вместо ручки.",
];
const lastCasino = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYMPHONY = /робот\s+может\s+сочинить\s+симфони/i;

const PLAY = /^сыграйбля[\s,:;!.-]+(.{2,})$/is;
const VIDEO_URL = /https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com\/(?:reels?|p|tv)(?=\/))\/?\S*/i;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    // Служебное: POST /restart (с секретом вебхука) — убить живой экземпляр контейнера, чтобы после деплоя поднялась новая версия.
    if (new URL(request.url).pathname === "/restart") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      await getContainer(env.DOWNLOADER).destroy();
      return new Response("container destroyed");
    }
    // Служебное: POST /debug {query} (с секретом вебхука) — пробный запуск загрузки в контейнере, возвращает реальную ошибку.
    if (new URL(request.url).pathname === "/debug") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      return getContainer(env.DOWNLOADER).fetch("http://container/probe", { method: "POST", body: await request.text() });
    }
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
      const c = query.match(COORDS);
      let results;
      if (c) {
        const [lat, lng, name, note] = placeFor(c[1].trim());
        results = [{
          type: "venue", id: "coords", latitude: lat, longitude: lng,
          title: c[1].trim(), address: `${name}. ${note}`,
        }];
      } else {
        results = query.length < 2 ? [] : buildResults(query, t ? t.cats : CATEGORIES);
      }
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
    const isGroup = msg && !isPrivate && msg.chat.type !== "channel";
    if (isGroup && text && /^\/forget(@\w+)?\b/i.test(text)) {
      const n = await forget(env, msg.chat.id, msg.from.id);
      await reply(env, msg, `Забыл всё, что ты писал(а) здесь: ${n} сообщ.`);
      return new Response("ok");
    }
    // Запоминаем текст и подписи к фото группы для контекста (команды и сообщения ботов не храним).
    const saved = (msg?.text || msg?.caption || (msg?.photo ? "[фото]" : "")).trim();
    if (isGroup && saved && !saved.startsWith("/") && !msg.from?.is_bot) {
      await remember(env, msg.chat.id, msg.from.id, msg.from.first_name || msg.from.username || "аноним",
        msg.photo && (msg.caption || "").trim() ? `[фото] ${msg.caption}` : saved, msg.message_id,
      ).catch((e) => console.error("remember", e.message));
    }
    if (text && /^\/(start|help)(@\w+)?\b/i.test(text)) {
      await reply(env, msg, HELP);
      return new Response("ok");
    }
    // Служебное: медиа в личке — отвечаем file_id, по нему файл можно скачать через Bot API (getFile).
    const media = msg?.video || msg?.audio || msg?.voice || msg?.video_note || msg?.animation || msg?.document;
    if (isPrivate && media) {
      await reply(env, msg, `file_id: <code>${media.file_id}</code>\nразмер: ${media.file_size ?? "?"} байт`);
      return new Response("ok");
    }
    // В личке любой текст — запрос РФ (или «найди …» — мир), в группах нужен триггер.
    const t = text && !text.startsWith("/")
      ? (parseTrigger(text) || (isPrivate ? { cats: CATEGORIES, query: text } : null))
      : null;
    const wm = text && text.match(WEATHER);
    const city = wm && CITIES.find(([stem]) => wm[1].toLowerCase().startsWith(stem));
    if (city && Date.now() - (lastWeather.get(msg.chat.id) ?? 0) > 20_000) {
      lastWeather.set(msg.chat.id, Date.now());
      ctx.waitUntil(
        getContainer(env.DOWNLOADER).fetch("http://container/weather", {
          method: "POST",
          body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, city: city[3], lat: city[1], lon: city[2] }),
        }),
      );
      return new Response("ok");
    }
    if (text && CASINO.test(text) && Date.now() - (lastCasino.get(msg.chat.id) ?? 0) > 4000) {
      lastCasino.set(msg.chat.id, Date.now());
      ctx.waitUntil((async () => {
        const r = await (await tg(env, "sendDice", {
          chat_id: msg.chat.id, emoji: "🎰", reply_parameters: { message_id: msg.message_id },
        })).json();
        const v = r.result?.dice?.value;
        if (!v) return;
        await sleep(3500); // дать барабанам остановиться, иначе спойлер
        if (!JACKPOTS.has(v)) {
          await tg(env, "sendMessage", { chat_id: msg.chat.id, text: CASINO_LOSS[Math.floor(Math.random() * CASINO_LOSS.length)] });
          return;
        }
        // выигрыш: случайный участник чата (кто писал), тег через tg://user — работает и без username
        const row = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id=? AND user_id!=0 GROUP BY user_id ORDER BY RANDOM() LIMIT 1")
          .bind(msg.chat.id).first().catch(() => null);
        const who = row ? `<a href="tg://user?id=${row.user_id}">${esc(row.name)}</a>` : "все остальные";
        await tg(env, "sendMessage", {
          chat_id: msg.chat.id, parse_mode: "HTML",
          text: CASINO_WIN[Math.floor(Math.random() * CASINO_WIN.length)].replace("{who}", who),
        });
      })());
      return new Response("ok");
    }
    if (text && SYMPHONY.test(text)) {
      await sendVoice(env, msg, INSULT_OGG_B64, INSULT_DURATION, "symphony.ogg");
      return new Response("ok");
    }
    if (text && GAV_CALL.test(text)) {
      await sendGav(env, msg);
      return new Response("ok");
    }
    // Сообщение от чужого бота (или через его inline) — посылаем.
    const other = msg?.from?.is_bot ? msg.from : msg?.via_bot;
    if (other && shouldRoast(msg.chat.id, other.id)) {
      console.log("roast bot", other.username);
      await reply(env, msg, esc((await withTyping(env, msg.chat.id, () => llmRoast(env, msg.text || msg.caption))) ?? pickRoast()));
      return new Response("ok");
    }
    // Человек ответил чужому боту: бот-автор виден в reply_to_message, ругаемся прямо под его сообщением.
    const target = msg?.reply_to_message;
    const ownId = Number(env.BOT_TOKEN.split(":")[0]);
    if (target?.from?.is_bot && target.from.id !== ownId && shouldRoast(msg.chat.id, target.from.id, { cooldown: 5_000, chance: 1 })) {
      await tg(env, "sendMessage", {
        chat_id: msg.chat.id,
        reply_parameters: { message_id: target.message_id },
        text: (await withTyping(env, msg.chat.id, () => llmRoast(env, target.text || target.caption, msg.text))) ?? pickRoast(),
      });
      return new Response("ok");
    }
    // «сыграйбля <название или ссылка>» — присылаем трек аудиофайлом.
    const play = text && text.match(PLAY);
    if (play) {
      ctx.waitUntil(
        getContainer(env.DOWNLOADER).fetch("http://container/audio", {
          method: "POST",
          body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, query: play[1].trim() }),
        }),
      );
      return new Response("ok");
    }
    // Ссылка на YouTube/TikTok в любом сообщении — скачиваем видео.
    const link = text && text.match(VIDEO_URL);
    if (link) {
      ctx.waitUntil(
        getContainer(env.DOWNLOADER).fetch("http://container/download", {
          method: "POST",
          body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, url: link[0] }),
        }),
      );
      return new Response("ok");
    }
    const c = t && t.query.match(COORDS);
    if (c) {
      const phrase = c[1].trim();
      const [lat, lng, name, note] = placeFor(phrase);
      await tg(env, "sendVenue", {
        chat_id: msg.chat.id,
        reply_parameters: { message_id: msg.message_id },
        latitude: lat, longitude: lng,
        title: phrase.slice(0, 100), address: `${name}. ${note}`,
      });
    } else if (t && t.query.length >= 2) {
      const rude = RUDE.test(t.query);
      await reply(env, msg, rude
        ? JOKES[Math.floor(Math.random() * JOKES.length)]
        : `Ищу «${esc(t.query)}»:\n${linksText(t.query, t.cats)}`);
    }
    // Ни один триггер не сработал: участвуем в беседе (если обратились — всегда), иначе иногда лаем.
    if (text && !isPrivate && !text.startsWith("/")) {
      const ownUsername = /@najdibot\b/i.test(text);
      const toUs = msg.reply_to_message?.from?.id === ownId;
      if (await maybeChat(env, msg, (m, b) => tg(env, m, b), { forced: ownUsername || toUs })) {
        return new Response("ok");
      }
      if (shouldBark(msg.chat.id)) {
        await reply(env, msg, BARKS[Math.floor(Math.random() * BARKS.length)]);
      }
    }
    return new Response("ok");
  },
};
