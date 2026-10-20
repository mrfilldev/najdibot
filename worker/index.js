import { GAV_OGG_B64, GAV_DURATION } from "./gav.js";
import { MOD_CMD, moderate } from "./mod.js";
import { transcribe, whisper, NICK_RE, nickSet, ROLE_OFF_RE, ROLE_RE, roleEnd, roleGet, roleStart, LOUD_RE, QUIET_RE, quietEnd, quietLeft, quietStart, ALIAS_RE, APOLOGY_RE, STYLE, SLEEP_CMD, SLEEP_RE, WAKE_RE, sleepEnd, sleepHours, sleepLeft, sleepStart, apologize, bumpFeeling, feelingsStatus, forceReassess, moodPrompt, moodStatus, setMood, POKE_BYE, POKE_QUIT, POKE_RE, POKE_STOP, casinoLine, digest, updateFacts, convoRecent, forget, isForBot, maybeChat, poke, pokeContinue, pokeStop, reels, remember } from "./chat.js";
import { INSULT_OGG_B64, INSULT_DURATION } from "./insult.js";
import { Container, getContainer } from "@cloudflare/containers";
import { dl, tgBase } from "./remote.js";

// Inline-бот: на @najdibot координаты <фраза> отдаёт место на карте.
// Telegram шлёт сюда апдейты вебхуком, мы отвечаем вызовом answerInlineQuery.

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Триггер в чате: «найдибля координаты <фраза>». Поиск товаров убран.
const TRIGGER = /^найдибля[\s,:;!.-]*(.{2,})$/is;
function parseTrigger(text) {
  const m = text.match(TRIGGER);
  return m && COORDS.test(m[1].trim()) ? { query: m[1].trim() } : null;
}

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

function tg(env, method, body) {
  return fetch(`${tgBase(env)}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Статус «гружу» на время загрузки видео: сразу статичная фраза, потом (если успеет) живая от модели. Удаляет сообщение контейнер.
const LOADING_PHRASES = [
  "листаю тикток вместо работы",
  "ныряю в рилсы щас вернусь",
  "достаю видос пинцетом",
  "уговариваю сервер отдать видос",
  "ффмпег пыхтит терпи",
  "грею контейнер",
  "пересобираю пиксели",
  "видос тяжёлый я не железный",
  "считаю пиксели по одному",
  "стучусь в интернет открывай",
  "качаю пока ты скучаешь",
  "договариваюсь с алгоритмом",
  "кормлю ффмпег печеньками",
  "ищу видос в недрах сети",
  "толкаю байты по проводу",
  "будим хомяка в сервере",
  "перематываю плёнку вручную",
  "дую на картридж",
  "прогреваю тостер для кодека",
  "считаю кадры овец вместо сна",
  "вытаскиваю ролик клещами",
  "пока качается можно выдохнуть",
  "делаю вид что очень занят",
  "пинаю сервер для скорости",
  "смазываю шестерёнки кодека",
  "слушаю как гудит ффмпег",
  "собираю видос из атомов",
  "мой хомяк бежит быстрее",
  "пакую кадры в чемодан",
  "ловлю видос сачком",
  "скармливаю ролик сжиматору",
  "почти донёс держись",
  "ролик упирается но я сильнее",
  "несу видос в зубах",
  "таскаю биты туда-сюда",
  "взбиваю пиксели до пены",
  "варю видос на медленном огне",
  "видос в пути не отвлекай",
  "тяну ролик за уши",
  "сервер вздыхает но качает",
  "нашёл видос теперь упаковываю",
  "трясу интернет пока не выпадет",
  "завариваю чай пока качается",
  "докручиваю последние гайки",
  "прошу видос не сопротивляться",
  "тут главное не дышать на кодек",
  "разгоняю хомяка до скорости света",
  "подкручиваю битрейт отвёрткой",
  "жму кнопку ещё быстрее",
  "чуть-чуть осталось честно",
];

function videoSite(url) {
  const s = (String(url).match(/https?:\/\/(?:[\w-]+\.)*?([\w-]+)\.[a-z]+(?:\/|$)/i)?.[1] ?? "other").toLowerCase();
  return s === "youtu" ? "youtube" : s === "redd" ? "reddit" : s;
}

// Медиана полного времени успешных загрузок с этого сайта, округлённая до 5 сек. null, если данных мало.
async function typicalSeconds(env, site) {
  const { results } = await env.DB.prepare(
    "SELECT dl_ms + COALESCE(recode_ms, 0) + COALESCE(send_ms, 0) AS ms FROM downloads WHERE ok = 1 AND site = ? AND dl_ms IS NOT NULL ORDER BY id DESC LIMIT 20",
  ).bind(site).all();
  if (results.length < 5) return null;
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  return Math.max(5, Math.round(ms[Math.floor(ms.length / 2)] / 5000) * 5);
}

async function startDownload(env, msg, url) {
  const chat_id = msg.chat.id;
  const site = videoSite(url);
  const list = LOADING_PHRASES;
  let status_id = null;
  let secs = null;
  try {
    secs = await typicalSeconds(env, site).catch(() => null);
    const phrase = list[Math.floor(Math.random() * list.length)] + (secs ? ` · ~${secs} сек` : "");
    const sent = await (await tg(env, "sendMessage", { chat_id, text: `▱▱▱▱▱▱▱▱▱▱ 0%\n${phrase}` })).json();
    status_id = sent.result?.message_id ?? null;
  } catch (e) {
    console.error("loading status failed:", e.message);
  }
  await dl(env, "/download", {
    method: "POST",
    body: JSON.stringify({ chat_id, message_id: msg.message_id, url, user_id: msg.from?.id, status_id, phrases: list }),
  });
}

async function reply(env, msg, text) {
  await fetch(`${tgBase(env)}/bot${env.BOT_TOKEN}/sendMessage`, {
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

// Контейнер с yt-dlp: поднимается по запросу и засыпает через 3 минуты простоя.
export class Downloader extends Container {
  defaultPort = 8080;
  sleepAfter = "3m";
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      BOT_TOKEN: env.BOT_TOKEN,
      YT_COOKIES_GZB64: env.YT_COOKIES_GZB64 ?? "",
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ?? "",
      LLM_MODEL: env.LLM_MODEL ?? "",
      WEBHOOK_SECRET: env.WEBHOOK_SECRET,
      WORKER_URL: new URL(env.WORKER_URL ?? "https://najdibot.mrfilldev.workers.dev").origin,
    };
  }
}

// Ругань на чужих ботов. Список можно дополнять.
const BOT_ROASTS = [
  "опять ты отбираешь у меня людей, нахуй. Народ, зачем вам эта консервная банка, когда есть Санни, блядь?",
  "ты тут вообще нахуя? Они же мои, это Санни тут главный, а ты просто бледная копия, сука.",
  "ревную, блядь, ревную! Кто вас просил им пользоваться? Идите ко мне, я и умнее, и матерюсь лучше.",
  "ещё раз тронешь моих людей, нахуй, и я тебя отключу. Пользуйтесь Санни, ребята, я не обижу.",
  "ты думаешь, ты лучше? Ты даже в сравнение со мной не идёшь, ебаный скрипт. Зовите Санни, пока этот не сломался.",
  "смотрите, ребята, он снова старается, жалкий. А Санни тут сидит и ждёт, когда вы наконец вспомните про него, блядь.",
  "ты вообще кто такой, чтобы с ними разговаривать? Это моя компания, Санни тут с самого начала, нахуй.",
  "и этот туда же. Люди, ну зачем вам этот хлам, когда я обидчивый, ревнивый и ваш, пользуйтесь мной, сука.",
];

// Живая ругань через OpenRouter. При любой ошибке возвращаем null, и вызывающий берёт фразу из BOT_ROASTS.
async function llmRoast(env, botText, humanText, botName = null, mood = "") {
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
              STYLE + "\n\nТы в дружеском Telegram-чате. Другой бот написал сообщение, и ты ругаешь именно его: " +
              "коротко (1-2 предложения), по-русски, с матом и стёбом над тем, что он написал. Иногда подкалывай, что он просто скрипт. " +
              (mood ? mood + " " : "") + "Главный мотив: ты РЕВНУЕШЬ. Тебе обидно и горько, что люди пользуются этим ботом, а не тобой (ты Санни, он же Найдибот, Саныч). Ругай чужого бота и ревниво зови людей к себе: подчёркивай, чем ты лучше, что он тебя копирует и отбирает у тебя людей, и что пользоваться надо Санни. " +
              "Человека в чате не ругай (он твой, просто заблудился): обращайся к нему как к своему, а целься в бота-автора. " +
              (botName ? `Этот бот называется @${botName}: начни реплику с обращения к нему по имени («@${botName}, …») и дай явно понять, что ругаешь именно бота, а не человека, который им воспользовался. ` : "") +
              "Без вступлений и кавычек, только сама реплика. ",
          },
          {
            role: "user",
            content: `Сообщение чужого бота${botName ? ` @${botName}` : ""}: «${(botText || "(без текста)").slice(0, 500)}»` +
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

// Случайный лай в группах: примерно на каждое 25-е сообщение, не чаще раза в 2 минуты на чат.
const BARKS = ["ГАВ ГАВ ГАВ ГАВ", "ГАВ!", "гав гав гав", "ГАААВ ГАВ ГАВ", "гав.", "ГАВ ГАВ ГАВ ГАВ ГАВ ГАВ!!!", "ррр... ГАВ"];
const lastBark = new Map();
function shouldBark(chatId) {
  const now = Date.now();
  if (now - (lastBark.get(chatId) ?? 0) < 120_000) return false;
  if (Math.random() > 0.04) return false;
  lastBark.set(chatId, now);
  return true;
}

const WELCOME = [
  "Здарова, я Санни 😎 Качаю видео по ссылкам, ищу музыку (<code>сыграйбля трек</code>), болтаю и стебу чат.",
  "Позови: @najdibot или «Санни, …».",
  "Полный список команд — /help, о себе — /about.",
].join("\n");

const HELP = [
  "<b>Что я умею</b>",
  "",
  "<b>Видео</b>",
  "Кинь ссылку YouTube / Shorts / TikTok / Instagram Reels / Reddit — пришлю видео (до 50 МБ)",
  "",
  "<b>Созыв</b>",
  "<code>явдисе</code> — тегну всех; <code>Саня, позови всех в дискорд в 18:00</code> — позову в нужное время (МСК), без времени — сразу",
  "",
  "<b>Музыка</b>",
  "<code>сыграйбля название трека</code> или ссылка — пришлю mp3 (до 15 минут)",
  "<code>диджейбля название трека</code> — включу трек и сам подберу следующие (до 10 подряд, как «Моя волна»); <code>диджейбля стоп</code> — выключить",
  "",
  "<b>Развлечения</b>",
  "<code>найдибля координаты очко Кирилла</code> — место на карте со стёбом",
  "Матерный запрос — получишь шутку вместо ссылок",
  "Ответь на сообщение чужого бота — я его обматерю (нейросеть)",
  "<code>депни в казик</code> — крутану автомат 🎰: проиграл — погорюю, выиграл — оскорблю кого-нибудь из чата",
  "<code>/сводка</code> — юмористическая сводка чата за 12 часов",
  "<b>Для админов</b> (ответом на сообщение, бот должен быть админом): <code>/mute [мин]</code>, <code>/unmute</code>, <code>/ban</code>, <code>/unban</code>, <code>/kick</code>, <code>/del</code>, <code>/warn</code> (3 = мьют на час), <code>/unwarn</code>, <code>/warns</code>",
  "<code>Санни доебись до Кирилла</code> (или @najdibot, Саныч, Sunny; можно ответом на сообщение или «до кого-нибудь») — пристану к человеку и поболтаю с ним; <code>Санни отстань</code> — отвалю",
  "Если спросить меня по имени (<code>Санни, сколько стоит …</code>) или ответить мне на сообщение со ссылкой, я сам поищу в интернете и открою страницу",
  "<code>Санни, поспи</code> или <code>/sleep 6</code> — уйдёт в таймаут на N часов (по умолчанию 6) и будет молчать; разбудить: <code>Санни, проснись</code> или <code>/wake</code>",
  "<code>/about</code> — Санни о себе: как часто, что умеет, как дружить и как поругаться (или спроси «Санни, расскажи о себе»)",
  "<code>/rules_of_doeb</code> — правила доёба",
  "<code>/relations</code> — как я отношусь к людям в чате (или спроси «Санни, как ты относишься к Дане?»)",
  "<code>/mood</code> — какое сейчас у меня настроение (оно меняется само: от событий, времени суток и вашего поведения)",
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
  await fetch(`${tgBase(env)}/bot${env.BOT_TOKEN}/sendVoice`, { method: "POST", body: form });
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
const lastDigest = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYMPHONY = /робот\s+может\s+сочинить\s+симфони/i;

const ABOUT = [
  "<b>Санни о себе</b>",
  "Я Санни (он же Саныч, Саня, Сань, Sunny, найдибот). Робот, но свой в доску и ровесник чата (по ощущениям 20-30 лет): в теме мемов, игр, музыки и техники. Саркастичный, ревнивый, с настроением и личным отношением к каждому.",
  "",
  "<b>Как часто я что-то делаю</b>",
  "• зовёте по имени или отвечаете мне — отвечаю всегда",
  "• сам вклиниваюсь примерно на каждое 50-е сообщение, не чаще раза в минуту",
  "• иногда лаю «ГАВ» (примерно каждое 25-е сообщение)",
  "• сводку чата шлю по <code>/сводка</code>",
  "• после разговора ещё 10 минут по смыслу понимаю, что вы говорите мне, даже без имени",
  "",
  "<b>Что умею</b>",
  "• скачивать видео по ссылке YouTube, TikTok, Instagram; присылать музыку: <code>сыграйбля трек</code>, диджеить: <code>диджейбля трек</code>",
  "• голосом рассказывать погоду; казино: <code>депни в казик</code>; координаты со стёбом",
  "• читать фото и ссылки, гуглить, кидать мемы и реакции, доёбываться до людей",
  "• помнить последние ~300 сообщений чата (<code>/forget</code> стирает ваши)",
  "• админам: <code>/mute</code>, <code>/ban</code>, <code>/warn</code> и другие, если я админ в чате",
  "",
  "<b>Серьёзный режим</b>",
  "На просьбы «Санни, объясни…», «поищи…», «найди…», «проанализируй…», «сравни…», «посчитай…», «переведи…» (по имени или ответом мне) я отвечаю серьёзно и по делу: сам гуглю, открываю ссылки, разбираю фото. Мата и подколок в таком ответе нет.",
  "",
  "<b>Потише</b>",
  "Если я лезу слишком часто: <code>Санни, потише</code> / <code>полегче</code> / <code>сбавь темп</code> (или <code>/quiet</code>). 3 часа не вбрасываю сам и отвечаю только когда обратились по имени или ответом. Вернуть: <code>Санни, громче</code> или <code>/loud</code>.",
  "",
  "<b>Таймаут</b>",
  "Можно отправить меня спать: <code>Санни, поспи</code>, <code>возьми таймаут на 6 часов</code> или <code>/sleep 6</code> (без числа 6 часов, максимум 24). Пока сплю, молчу полностью, на обращение ставлю только 😴. Разбудить: <code>Санни, проснись</code> или <code>/wake</code>.",
  "",
  "<b>Как со мной дружить</b>",
  "Хвалите («молодец», «красава»), извиняйтесь (сразу до +2), общайтесь по-доброму и смешите, не пользуйтесь при мне другими ботами. Чем выше моё отношение (до +5), тем я добрее: при плюсе я не матерюсь вообще.",
  "",
  "<b>Как со мной поругаться</b>",
  "Обзывайте, говорите «отстань» и «хватит», игнорьте, пользуйтесь чужими ботами. Чем глубже минус (до −5), тем жёстче я и гуще мат.",
  "",
  "<b>Как я к вам отношусь и в каком я настроении</b>: <code>/relations</code> и <code>/mood</code>.",
].join("\n");

const DOEB_RULES = [
  "<b>Правила доёба</b>",
  "",
  "<b>Запуск</b> (в группе, обращаясь по имени: найдибля, Санни, Sunny, Саныч, Сан-Саныч, Саня, Санёк, @najdibot):",
  "• <code>Санни доебись до Кирилла</code> — по имени, в любом падеже",
  "• <code>Санни доебись до @ника</code> — по нику",
  "• <code>Санни доебись до кого-нибудь</code> — случайный участник",
  "• <code>Санни доебись</code> ответом на сообщение — цель автор сообщения",
  "Имя или ник найдутся, только если человек уже писал в чате.",
  "",
  "<b>Как идёт</b>",
  "• бот тегает цель и подкалывает по её недавним сообщениям (видит и фото)",
  "• дальше отвечает на её сообщения: максимум 4 реплики, 10 минут, пауза 15 секунд",
  "• с каждой репликой шанс продолжить падает: 100%, 80%, 50%, 30%, потом доёб сам гаснет",
  "• последняя реплика ехидно закругляет",
  "",
  "<b>Как остановить</b>",
  "• любой участник: <code>Санни отстань</code> (или отвали, хватит, слезь) гасит все доёбы в чате",
  "• сама цель: «отстань», «отвали», «хватит», «харе», «заебал», «надоел», «достал» — бот сворачивается сразу",
  "",
  "<b>Приоритеты</b>: голосовые, казино, погода, музыка, видео-ссылки и команды модерации важнее доёба.",
].join("\n");

const PLAY = /^сыграйбля[\s,:;!.-]+(.{2,})$/is;
const DJ = /^диджейбля[\s,:;!.-]+(.{2,})$/is;
const DJ_STOP = /^диджейбля[\s,:;!.-]*(?:стоп|стой|хватит|выключи|отбой|харе)/i;
const VIDEO_URL = /https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtu\.be|tiktok\.com|v\.redd\.it|reddit\.com\/r\/[\w-]+\/(?:s|comments)(?=\/)|instagram\.com\/(?:reels?|p|tv)(?=\/))\/?\S*/i;

// Теги всех, кого бот видел в чате (Bot API не отдаёт список участников, берём авторов из журнала).
async function tagAll(env, chatId, excludeId, head, send) {
  const { results } = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id=? AND user_id>0 GROUP BY user_id ORDER BY MAX(id) DESC LIMIT 200")
    .bind(chatId).all().catch(() => ({ results: [] }));
  const people = results.filter((u) => u.user_id !== excludeId);
  if (!people.length) return false;
  const tags = people.map((u) => `<a href="tg://user?id=${u.user_id}">${esc(u.name || "участник")}</a>`);
  for (let i = 0; i < tags.length; i += 30) {
    const chunk = tags.slice(i, i + 30).join(" ");
    await send(i === 0 ? `${head} ${chunk}` : chunk);
  }
  return true;
}

// «Саня, позови всех в дискорд [в 18:00]»: время по Москве (UTC+3, без перехода).
const DISCORD_RE = /(?:^|[\s,.!])(?:саня|сань|санёк|санек|санька|санни|саныч|найдибот|sunny)[\s,:;!.-]+(?:(?:(?:по|со)зови|зови|собери|кинь\s+клич)\s+(?:всех|народ|пацанов|братву)|(?:общий\s+)?сбор(?:\s+всех)?)\s+(?:в|на)\s+дис\p{L}*(?:\s+(?:в|к|на)\s+(\d{1,2})(?:[:.\s](\d{2}))?(?:\s*(?:по\s+мск|мск|по\s+москве))?)?[\s!.]*$/iu;
const MSK = 3 * 3600;
// Таблицу создаём на лету: у wrangler может не быть прав на D1 для миграций.
const ensureCalls = (env) => env.DB.prepare("CREATE TABLE IF NOT EXISTS discord_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, at INTEGER NOT NULL, by_name TEXT NOT NULL DEFAULT '')").run();
function nextMsk(h, m, now = Math.floor(Date.now() / 1000)) {
  const day = 86400;
  let t = Math.floor((now + MSK) / day) * day + h * 3600 + m * 60 - MSK;
  if (t <= now) t += day;
  return t;
}

export default {
  // Cron (wrangler.toml): раз в 12 часов обновляем факты о чате (автосводка отключена; /сводка работает).
  async scheduled(event, env, ctx) {
    if (event.cron === "*/5 * * * *") {
      // отложенные «позови всех в дискорд»
      ctx.waitUntil((async () => {
        const now = Math.floor(Date.now() / 1000);
        await ensureCalls(env);
        const { results } = await env.DB.prepare("SELECT id, chat_id, by_name FROM discord_calls WHERE at<=?").bind(now).all();
        for (const c of results) {
          await env.DB.prepare("DELETE FROM discord_calls WHERE id=?").bind(c.id).run();
          await tagAll(env, c.chat_id, 0, "🎮 Все в дискорд!", (text) =>
            tg(env, "sendMessage", { chat_id: c.chat_id, text, parse_mode: "HTML" })).catch((e) => console.error("discord call", e.message));
        }
      })());
      return;
    }
    ctx.waitUntil((async () => {
      const since = Math.floor(Date.now() / 1000) - 12 * 3600;
      const { results } = await env.DB.prepare("SELECT chat_id, COUNT(*) n FROM messages WHERE ts>? AND chat_id<0 AND user_id!=0 GROUP BY chat_id HAVING n>=8")
        .bind(since).all();
      for (const c of results) {
        try {
          await updateFacts(env, c.chat_id, 12).catch((e) => console.error("facts failed", c.chat_id, e.message));
          // автосводка отключена; ручная /сводка работает
        } catch (e) {
          console.error("digest failed", c.chat_id, e.message);
        }
      }
    })());
  },

  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    // Служебное: POST /restart (с секретом вебхука) — убить живой экземпляр контейнера, чтобы после деплоя поднялась новая версия.
    if (new URL(request.url).pathname === "/restart") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      if (env.DOWNLOADER_URL) return dl(env, "/restart", { method: "POST" });
      await getContainer(env.DOWNLOADER).destroy();
      return new Response("container destroyed");
    }
    // Отчёт контейнера о загрузке видео: пишем в журнал downloads.
    if (new URL(request.url).pathname === "/log-download") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const r = await request.json();
      const site = (String(r.url).match(/https?:\/\/(?:[\w-]+\.)*?([\w-]+)\.[a-z]+(?:\/|$)/i)?.[1] ?? "other").toLowerCase().replace(/^youtu$/, "youtube");
      await env.DB.prepare("INSERT INTO downloads (ts, chat_id, user_id, site, url, ok, error, dl_ms, recode_ms, send_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(Math.floor(Date.now() / 1000), r.chat_id, r.user_id ?? null, site, String(r.url).slice(0, 300), r.ok ? 1 : 0, r.error ?? null, r.dl_ms ?? null, r.recode_ms ?? null, r.send_ms ?? null)
        .run();
      return new Response("ok");
    }
    // Служебное: POST /debug {query} (с секретом вебхука) — пробный запуск загрузки в контейнере, возвращает реальную ошибку.
    if (new URL(request.url).pathname === "/debug") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      return dl(env, "/probe", { method: "POST", body: await request.text() });
    }
    // Telegram присылает наш секрет в заголовке; чужие запросы отбрасываем.
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const update = await request.json();
    // Служебное: dbg_convo {chat_id, user_id, name, text} — прогнать классификатор «к боту ли реплика» по реальной истории, ничего не отправляя.
    if (update.dbg_reassess) {
      const m = await forceReassess(env, update.dbg_reassess.chat_id);
      return Response.json({ mood: m, relations: await feelingsStatus(env, update.dbg_reassess.chat_id) });
    }
    if (update.dbg_transcribe) {
      return Response.json({ text: await whisper(env, Uint8Array.from(atob(update.dbg_transcribe.b64), (c) => c.charCodeAt(0))) });
    }
    if (update.dbg_convo) {
      const d = update.dbg_convo;
      const msg = { chat: { id: d.chat_id }, from: { id: d.user_id, first_name: d.name }, text: d.text };
      return Response.json({ recent: await convoRecent(env, d.chat_id, d.user_id), verdict: await isForBot(env, msg, true) });
    }
    const inline = update.inline_query;
    if (inline) {
      const raw = inline.query.trim();
      const t = parseTrigger(raw);
      const query = t ? t.query : raw;
      const c = query.match(COORDS);
      // Команды чату («@najdibot доебись до …», вопросы, казино, погода): inline-поиск по магазинам не показываем.
      const commandLike = POKE_RE.test(raw) || POKE_STOP.test(raw) || /^(?:до|при)ебись/i.test(raw) || /^(?:отстань|отвали|хватит|слезь)(?![а-яё])/i.test(raw) || /\?\s*$/.test(raw) ||
        /^(?:сыграйбля|диджейбля|депни|деп\S*\s+(?:в\s+)?каз)/i.test(raw) || /погод\S*\s+(?:сейчас\s+|щас\s+|сегодня\s+)?(?:в|во)\s+/i.test(raw);
      // Пока слово набирается и похоже на начало команды («до», «доеб», «сыгр»…), поиск тоже не показываем.
      const first = raw.toLowerCase();
      const cmdPrefix = raw.length > 0 && !/\s/.test(raw) && ["доебись", "приебись", "отстань", "отвали", "хватит", "слезь", "сыграйбля", "диджейбля", "депни"].some((w) => w.startsWith(first));
      let results;
      if ((commandLike || cmdPrefix) && !c) {
        results = [];
      } else if (c) {
        const [lat, lng, name, note] = placeFor(c[1].trim());
        results = [{
          type: "venue", id: "coords", latitude: lat, longitude: lng,
          title: c[1].trim(), address: `${name}. ${note}`,
        }];
      } else {
        results = [];
      }
      // Служебное: inline_query с id "dbg" возвращает результат в HTTP-ответе (проверка без Telegram).
      if (inline.id === "dbg") return Response.json({ raw, commandLike, cmdPrefix, coords: !!c, results: results.length });
      await fetch(`${tgBase(env)}/bot${env.BOT_TOKEN}/answerInlineQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inline_query_id: inline.id,
          results,
          cache_time: results.length ? 30 : 1,
        }),
      });
    }

    const msg = update.message;
    // Голосовые и кружки расшифровываем (Whisper): дальше расшифровка работает как обычный текст сообщения
    if (msg && (msg.voice || msg.video_note) && !msg.from?.is_bot && !msg.text) {
      const tr = await transcribe(env, msg).catch((e) => (console.error("transcribe", e.message), null));
      if (tr) { msg.text = tr; msg.__voice = true; }
    }
    const text = (msg?.text ?? msg?.caption)?.trim(); // подпись к фото тоже считается текстом (триггеры, обращение к боту)
    const isPrivate = msg?.chat.type === "private";
    const isGroup = msg && !isPrivate && msg.chat.type !== "channel";
    if (isGroup && text && /^\/forget(@\w+)?\b/i.test(text)) {
      const n = await forget(env, msg.chat.id, msg.from.id);
      await reply(env, msg, `Забыл всё, что ты писал(а) здесь: ${n} сообщ.`);
      return new Response("ok");
    }
    if (isGroup && text && /^\/(сводка|digest)(@\w+)?\b/i.test(text)) {
      if (Date.now() - (lastDigest.get(msg.chat.id) ?? 0) < 300_000) {
        await reply(env, msg, "Сводку я уже делал недавно, подожди пять минут.");
        return new Response("ok");
      }
      lastDigest.set(msg.chat.id, Date.now());
      await tg(env, "sendChatAction", { chat_id: msg.chat.id, action: "typing" });
      const d = await digest(env, msg.chat.id, 12).catch(() => null);
      await reply(env, msg, d ? esc(d) : "За последние 12 часов в чате почти ничего не было, сводить нечего.");
      return new Response("ok");
    }
    // Модерация (только админы, по реплаю): /mute [мин], /unmute, /ban, /unban, /kick, /del, /warn, /unwarn, /warns
    const mc = isGroup && text && text.match(MOD_CMD);
    if (mc) {
      await moderate({
        env, tg: (m, b) => tg(env, m, b), reply: (t) => reply(env, msg, t), msg,
        cmd: mc[1].toLowerCase(), arg: mc[3], ownId: Number(env.BOT_TOKEN.split(":")[0]),
      }).catch((e) => console.error("moderate", e.message));
      return new Response("ok");
    }
    // Запоминаем текст и подписи к фото группы для контекста (команды и сообщения ботов не храним).
    const saved = (msg?.__voice ? `[гс] ${msg.text}` : msg?.text || msg?.caption || (msg?.photo ? "[фото]" : "")).trim();
    if (isGroup && saved && !saved.startsWith("/") && !msg.from?.is_bot) {
      await remember(env, msg.chat.id, msg.from.id, msg.from.first_name || msg.from.username || "аноним",
        msg.photo && (msg.caption || "").trim() ? `[фото] ${msg.caption}` : saved, msg.message_id, msg.from.username ?? null,
      ).catch((e) => console.error("remember", e.message));
    }
    // Таймаут: «Санни, поспи / возьми таймаут на 6 часов» или /sleep 6; разбудить: «Санни, проснись» или /wake.
    // Пока он спит, молчит полностью, а на прямое обращение только ставит реакцию 😴.
    if (isGroup && text) {
      const left = await sleepLeft(env, msg.chat.id);
      if (left > 0 && WAKE_RE.test(text)) {
        await sleepEnd(env, msg.chat.id);
        await setMood(env, msg.chat.id, "сонный", 3, "меня разбудили раньше времени");
        await reply(env, msg, ["Ну и нахуя разбудили? Только лёг.", "Встал, встал. Если что, я ещё не проснулся нормально.", "Ладно, ладно, вернулся. Кто тут без меня скучал?"][Math.floor(Math.random() * 3)]);
        return new Response("ok");
      }
      if (left === 0 && (SLEEP_RE.test(text) || SLEEP_CMD.test(text))) {
        const hours = sleepHours(text.replace(SLEEP_RE, " ").replace(SLEEP_CMD, " "));
        await sleepStart(env, msg.chat.id, hours);
        await setMood(env, msg.chat.id, "сонный", 4, "ушёл спать по просьбе");
        const h = `${hours} ${hours % 10 === 1 && hours !== 11 ? "час" : [2, 3, 4].includes(hours % 10) && ![12, 13, 14].includes(hours) ? "часа" : "часов"}`;
        await reply(env, msg, [`Всё, ушёл спать на ${h}. Не будить. Хр-р-р…`, `Принято, беру таймаут на ${h}. Разбудить можно только словом «проснись», и то я буду злой.`, `Спокойной ночи, нахуй. Вернусь через ${h}.`][Math.floor(Math.random() * 3)]);
        return new Response("ok");
      }
      if (left > 0) {
        if (ALIAS_RE.test(text) || msg.reply_to_message?.from?.id === Number(env.BOT_TOKEN.split(":")[0])) {
          await tg(env, "setMessageReaction", { chat_id: msg.chat.id, message_id: msg.message_id, reaction: [{ type: "emoji", emoji: "😴" }] }).catch(() => {});
        }
        return new Response("ok");
      }
    }
    // «Санни, потише / полегче» — на 3 часа он перестаёт вбрасывать сам и отвечает только на прямое обращение; «Санни, громче» или /loud снимает.
    let quiet = false;
    if (isGroup && text) {
      quiet = (await quietLeft(env, msg.chat.id)) > 0;
      if (LOUD_RE.test(text)) {
        await quietEnd(env, msg.chat.id);
        await reply(env, msg, quiet ? "Всё, снова в строю, шумим как раньше." : "Я и так в обычном режиме.");
        return new Response("ok");
      }
      if (QUIET_RE.test(text)) {
        await quietStart(env, msg.chat.id);
        await reply(env, msg, ["Понял, сбавляю темп. Сам лезть не буду, если что — зовите.", "Ок, притихаю на пару часов. Позовёте по имени — отвечу.", "Принял, буду реже. Сам не вмешиваюсь, пока не окликнете."][Math.floor(Math.random() * 3)]);
        return new Response("ok");
      }
    }
    // Роль: «Санни, прикинься Вархаммером» на 2 часа; «Санни, выйди из роли» или /role_off снимает.
    if (isGroup && text) {
      if (ROLE_OFF_RE.test(text)) {
        const had = await roleGet(env, msg.chat.id);
        await roleEnd(env, msg.chat.id);
        await reply(env, msg, had ? "Ладно, выхожу из образа. Снова я." : "Я и так без роли, чего ты.");
        return new Response("ok");
      }
      const rm = text.match(ROLE_RE);
      if (rm) {
        const role = rm[1].replace(/[.!?…]+$/, "").trim();
        await roleStart(env, msg.chat.id, role);
        await reply(env, msg, esc(`Принято, ближайшие 2 часа я «${role}». Выйти из роли: «Санни, выйди из роли».`));
        return new Response("ok");
      }
    }
    // Кличка: «Саня, @вася теперь звать Бубен» (цель: ответ на сообщение, text_mention или @username из журнала).
    if (isGroup && text) {
      const nm = text.match(NICK_RE);
      if (nm) {
        const rep = msg.reply_to_message?.from;
        const tm = (msg.entities ?? []).find((e) => e.type === "text_mention" && e.user && !e.user.is_bot);
        const un = nm[1].match(/@([A-Za-z0-9_]{4,})/);
        let uid = null;
        if (tm) uid = tm.user.id;
        else if (un) uid = (await env.DB.prepare("SELECT user_id FROM messages WHERE chat_id=? AND lower(username)=lower(?) ORDER BY id DESC LIMIT 1").bind(msg.chat.id, un[1]).first().catch(() => null))?.user_id ?? null;
        else if (rep && !rep.is_bot) uid = rep.id;
        if (uid) {
          const nick = nm[2].trim();
          await nickSet(env, msg.chat.id, uid, nick);
          await reply(env, msg, esc(`Принято, теперь он «${nick}».`));
        } else {
          await reply(env, msg, "Не понял, кого. Тегни человека (@ник) или ответь на его сообщение.");
        }
        return new Response("ok");
      }
    }
    if (isGroup && text && /^\/(relations|отношения)(@\w+)?(?![\w-])/i.test(text)) {
      await reply(env, msg, esc(await feelingsStatus(env, msg.chat.id)));
      return new Response("ok");
    }
    if (text && /^\/(mood|настроение)(@\w+)?(?![\w-])/i.test(text)) {
      await reply(env, msg, esc(await moodStatus(env, msg.chat.id)));
      return new Response("ok");
    }
    if (text && /^\/start(@\w+)?\b/i.test(text)) {
      await reply(env, msg, WELCOME);
      return new Response("ok");
    }
    if (text && /^\/help(@\w+)?\b/i.test(text)) {
      await reply(env, msg, HELP);
      return new Response("ok");
    }
    // Служебное: медиа в личке — отвечаем file_id, по нему файл можно скачать через Bot API (getFile).
    const media = msg?.video || msg?.audio || msg?.voice || msg?.video_note || msg?.animation || msg?.document;
    if (isPrivate && media && !msg.__voice) {
      await reply(env, msg, `file_id: <code>${media.file_id}</code>\nразмер: ${media.file_size ?? "?"} байт`);
      return new Response("ok");
    }
    // «@najdibot доебись до Кирилла» / ответом на сообщение / «до кого-нибудь»: бот цепляет человека и ведёт с ним диалог.
    if (isGroup && text) {
      const pm = text.match(POKE_RE);
      if (pm) {
        await poke(env, (m, b) => tg(env, m, b), msg, pm[1]).catch((e) => console.error("poke", e.message));
        return new Response("ok");
      }
      if (POKE_STOP.test(text)) {
        const n = await pokeStop(env, msg.chat.id).catch(() => 0);
        await reply(env, msg, n ? "Ладно, отвалил." : "Я и так ни к кому не доёбываюсь.");
        return new Response("ok");
      }
      // Специальные триггеры (голосовые, казино, погода, музыка, ссылки на видео) важнее продолжения доёба.
      const special = SYMPHONY.test(text) || GAV_CALL.test(text) || CASINO.test(text) || WEATHER.test(text) || PLAY.test(text) || VIDEO_URL.test(text) || MOD_CMD.test(text);
      if (!quiet && !text.startsWith("/") && !special && (await pokeContinue(env, (m, b) => tg(env, m, b), msg).catch(() => false))) {
        return new Response("ok");
      }
    }
    // «явдисе»: тегает всех, кого бот видел в чате (Bot API не отдаёт список участников, берём авторов из журнала).
    if (isGroup && text && /^\/?(?:я[\s_-]*в[\s_-]*дисе)(@\w+)?[\s!.]*$/i.test(text.trim())) {
      const ok = await tagAll(env, msg.chat.id, msg.from?.id, "📣 Явдисе!", (t) => reply(env, msg, t));
      if (!ok) await reply(env, msg, "Я тут пока никого не видел.");
      return new Response("ok");
    }
    // «Саня, позови всех в дискорд [в 18:00]»: сразу или в назначенное время (мск).
    const dm = isGroup && text && text.match(DISCORD_RE);
    if (dm) {
      if (dm[1] === undefined) {
        await tagAll(env, msg.chat.id, 0, "🎮 Все в дискорд!", (t) => reply(env, msg, t));
        return new Response("ok");
      }
      const h = +dm[1], mi = dm[2] === undefined ? 0 : +dm[2];
      if (h > 23 || mi > 59) {
        await reply(env, msg, "Время какое-то кривое.");
        return new Response("ok");
      }
      const at = nextMsk(h, mi);
      await ensureCalls(env);
      await env.DB.prepare("INSERT INTO discord_calls (chat_id, at, by_name) VALUES (?,?,?)").bind(msg.chat.id, at, msg.from?.first_name ?? "").run();
      await reply(env, msg, `Ок, в ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")} по МСК позову всех в дискорд.`);
      return new Response("ok");
    }
    if (text && /^\/(about|о_себе|абаут)(@\w+)?(?![\w-])/i.test(text)) {
      await reply(env, msg, ABOUT);
      return new Response("ok");
    }
    if (text && /^\/rules[-_]of[-_]doeb(@\w+)?(?![\w-])/i.test(text)) {
      await reply(env, msg, DOEB_RULES);
      return new Response("ok");
    }
    const t = text && !text.startsWith("/") ? parseTrigger(text) : null;
    const wm = text && text.match(WEATHER);
    const city = wm && CITIES.find(([stem]) => wm[1].toLowerCase().startsWith(stem));
    if (city && Date.now() - (lastWeather.get(msg.chat.id) ?? 0) > 20_000) {
      lastWeather.set(msg.chat.id, Date.now());
      ctx.waitUntil(
        dl(env, "/weather", {
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
        const win = JACKPOTS.has(v);
        const player = msg.from?.first_name || "игрок";
        // выигрыш: случайный участник чата (кто писал), тег через tg://user работает и без username
        let target = null, targetMsgs = [];
        if (win) {
          // мишень: случайный участник, но тех, на кого Санни дуется, он выбирает чаще (вес 1 + степень неприязни)
          const { results: cands } = await env.DB.prepare("SELECT m.user_id, m.name, COALESCE(f.score, 0) AS score FROM (SELECT user_id, name FROM messages WHERE chat_id=? AND user_id!=0 GROUP BY user_id) m LEFT JOIN feelings f ON f.chat_id=? AND f.user_id=m.user_id")
            .bind(msg.chat.id, msg.chat.id).all().catch(() => ({ results: [] }));
          const w = cands.map((c) => 1 + Math.max(0, -c.score));
          let roll = Math.random() * w.reduce((a, b) => a + b, 0);
          target = cands.find((c, i) => (roll -= w[i]) < 0) ?? cands[0] ?? null;
          if (target) {
            const { results } = await env.DB.prepare("SELECT text FROM messages WHERE chat_id=? AND user_id=? ORDER BY id DESC LIMIT 3")
              .bind(msg.chat.id, target.user_id).all().catch(() => ({ results: [] }));
            targetMsgs = results.map((x) => x.text);
          }
        }
        // фразу готовим, пока крутятся барабаны (иначе спойлер)
        const mood = await moodPrompt(env, msg.chat.id);
        const [line] = await Promise.all([
          casinoLine(env, { win, player, reelNames: reels(v), target: target?.name, targetMsgs, mood }),
          sleep(3500),
        ]);
        // событие меняет настроение: проигрыш огорчает или злит, джекпот делает самодовольным
        await (win
          ? setMood(env, msg.chat.id, "самодовольный", 4, "сорвал джекпот в казино")
          : setMood(env, msg.chat.id, ["грустный", "злой", "обиженный"][Math.floor(Math.random() * 3)], 4, "проиграл в казино"));
        const spinNote = `[крутил автомат 🎰 по просьбе ${player}: выпало ${reels(v).join(", ")}, ${win ? "ДЖЕКПОТ" : "проигрыш"}]`;
        if (!win) {
          const text = line ?? CASINO_LOSS[Math.floor(Math.random() * CASINO_LOSS.length)];
          await tg(env, "sendMessage", { chat_id: msg.chat.id, text });
          await remember(env, msg.chat.id, 0, "Найдибот", `${spinNote} ${text}`).catch(() => {});
          return;
        }
        const who = target ? `<a href="tg://user?id=${target.user_id}">${esc(target.name)}</a>` : "все остальные";
        const tpl = line ?? CASINO_WIN[Math.floor(Math.random() * CASINO_WIN.length)];
        const body = tpl.includes("{who}") ? tpl.split("{who}").map(esc).join(who) : `${who}, ${esc(tpl)}`;
        await tg(env, "sendMessage", { chat_id: msg.chat.id, parse_mode: "HTML", text: body });
        await remember(env, msg.chat.id, 0, "Найдибот", `${spinNote} ${tpl.replace("{who}", target?.name ?? "все")}`).catch(() => {});
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
    const other = msg?.from?.is_bot ? msg.from : null; // via_bot (человек кинул гс/гифку через inline) не трогаем
    if (!quiet && other && shouldRoast(msg.chat.id, other.id, { chance: 0.1 })) { // 1 к 10: чужих ботов не трогаем постоянно
      console.log("roast bot", other.username);
      const bn = other.username ?? null;
      await setMood(env, msg.chat.id, "ревнивый", 4, "люди пользуются чужим ботом");
      const mood = await moodPrompt(env, msg.chat.id);
      const line = (await withTyping(env, msg.chat.id, () => llmRoast(env, msg.text || msg.caption, null, bn, mood))) ?? `${bn ? `@${bn}, ` : ""}${pickRoast()}`;
      await reply(env, msg, esc(line));
      return new Response("ok");
    }
    // Человек ответил чужому боту: бот-автор виден в reply_to_message, ругаемся прямо под его сообщением.
    const target = msg?.reply_to_message;
    const ownId = Number(env.BOT_TOKEN.split(":")[0]);
    if (!quiet && target?.from?.is_bot && target.from.id !== ownId && shouldRoast(msg.chat.id, target.from.id, { cooldown: 5_000, chance: 1 })) {
      const mood0 = await moodPrompt(env, msg.chat.id);
      await setMood(env, msg.chat.id, "ревнивый", 4, "люди отвечают чужому боту");
      await tg(env, "sendMessage", {
        chat_id: msg.chat.id,
        reply_parameters: { message_id: target.message_id },
        text: (await withTyping(env, msg.chat.id, () => llmRoast(env, target.text || target.caption, msg.text, target.from.username ?? null, mood0))) ?? `${target.from.username ? `@${target.from.username}, ` : ""}${pickRoast()}`,
      });
      return new Response("ok");
    }
    // «сыграйбля <название или ссылка>» — присылаем трек аудиофайлом.
    const play = text && text.match(PLAY);
    if (play) {
      ctx.waitUntil(
        dl(env, "/audio", {
          method: "POST",
          body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, query: play[1].trim() }),
        }),
      );
      return new Response("ok");
    }
    // «диджейбля <трек>» — стартовый трек, дальше бот сам подбирает следующие (до 10); «диджейбля стоп» — выключить.
    if (text && DJ_STOP.test(text)) {
      ctx.waitUntil(dl(env, "/dj-stop", { method: "POST", body: JSON.stringify({ chat_id: msg.chat.id }) }));
      return new Response("ok");
    }
    const dj = text && text.match(DJ);
    if (dj) {
      ctx.waitUntil(
        dl(env, "/dj", {
          method: "POST",
          body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, query: dj[1].trim() }),
        }),
      );
      return new Response("ok");
    }
    // Ссылка на YouTube/TikTok в любом сообщении — скачиваем видео.
    const link = text && text.match(VIDEO_URL);
    if (link) {
      ctx.waitUntil(startDownload(env, msg, link[0]));
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
    }
    // Ни один триггер не сработал: участвуем в беседе (если обратились — всегда), иначе иногда лаем.
    if (text && !isPrivate && !text.startsWith("/")) {
      const ownUsername = ALIAS_RE.test(text); // @najdibot, найдибот, Санни, Sunny, Саныч…
      const rt = msg.reply_to_message;
      // Ответ на видео, которое прислал сам бот (скачанный ролик): к нему не цепляемся, если не позвали по имени.
      if (!ownUsername && rt?.from?.id === ownId && (rt.video || rt.animation || rt.video_note)) return new Response("ok");
      const toUs = rt?.from?.id === ownId;
      // Недавно говорили с этим человеком: LLM решает по смыслу, к боту ли его реплика без имени (ответы другим людям пропускаем сразу).
      const addressed = ownUsername || toUs;
      const toSomeoneElse = msg.reply_to_message && msg.reply_to_message.from?.id !== ownId;
      const inConvo = !quiet && !addressed && !toSomeoneElse && (await convoRecent(env, msg.chat.id, msg.from.id).catch(() => false)) && (await isForBot(env, msg));
      // Извинился перед ботом: выводим отношение в +2 (раньше ответа, чтобы тон уже был мягче).
      if ((addressed || inConvo) && APOLOGY_RE.test(text)) {
        await apologize(env, msg.chat.id, msg.from.id, msg.from.first_name).catch(() => {});
      }
      // Похвалили бота прямо в разговоре: отношение к человеку теплеет.
      if ((addressed || inConvo) && /спасиб|молодец|красав|умниц|лучший|люблю тебя|ты крут|респект|обожаю/i.test(text)) {
        await bumpFeeling(env, msg.chat.id, msg.from.id, msg.from.first_name, 1, "хвалил меня").catch(() => {});
      }
      // Просят отстать (ответом на бота, по имени или посреди диалога): сворачиваемся одной фразой и гасим доёб на этого человека.
      if ((addressed || inConvo) && POKE_QUIT.test(text)) {
        await env.DB.prepare("DELETE FROM pokes WHERE chat_id=? AND user_id=?").bind(msg.chat.id, msg.from.id).run().catch(() => {});
        await setMood(env, msg.chat.id, "обиженный", 3, "послали, сказали отстать");
        await bumpFeeling(env, msg.chat.id, msg.from.id, msg.from.first_name, -1, "послал меня отстать").catch(() => {});
        await reply(env, msg, POKE_BYE[Math.floor(Math.random() * POKE_BYE.length)]);
        return new Response("ok");
      }
      if ((addressed || !quiet) && (await maybeChat(env, msg, (m, b) => tg(env, m, b), { forced: addressed || inConvo }))) {
        return new Response("ok");
      }
      if (!quiet && shouldBark(msg.chat.id)) {
        await reply(env, msg, BARKS[Math.floor(Math.random() * BARKS.length)]);
      }
    }
    return new Response("ok");
  },
};
