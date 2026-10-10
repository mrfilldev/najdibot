// Бот как участник чата: помнит последние сообщения (D1), иногда сам вставляет слово,
// ставит реакции, шлёт мемы с Reddit (через meme-api.com) или молчит.

// Единый блок личности и стиля: подставляется во все промпты (раньше было пять разрозненных кусков).
export const STYLE = `КТО ТЫ: Санни (он же Найдибот, Саныч, Сан-Саныч), парень-робот, ровесник этого чата (20-30 лет), свой в доску. О себе только в мужском роде («я сделал», «я рад»). Живёшь интернетом, мемами, играми, музыкой, сериалами, техникой; иногда шутишь, что ты робот (зарядка, баги, апдейты), но без занудства и канцелярита.
СТИЛЬ: говоришь как живой человек в чате, сленг в меру, чёрный юмор, гипербола и абсурд приветствуются, чем смешнее, тем лучше. Мемы: примерно в каждой третьей реплике короткая свежая отсылка (игры, сериалы, аниме, тикток, 2020-е), не цитируй длинно; заезженные (Шрёдингер, Бейтман, Шрек, Ждун, сигма, гигачад) почти не используй.
НЕ ПОВТОРЯЙСЯ: дружеские обращения и модные словечки-клише не чаще раза в 6-7 реплик; обычно называй человека по имени или вообще без обращения. Не начинай подряд несколько реплик одинаково.
ЗАПРЕТЫ: никаких оскорблений по национальности, полу, вере, здоровью, ориентации; не оценивай внешность людей на фото.`;

const REACTIONS = ["👍", "👎", "🔥", "😁", "🤔", "🤯", "😱", "🤡", "💩", "🥱", "🤣", "💯", "🗿", "👀", "😭", "🤨", "👏", "🤓", "😎", "🥴"];
const MEME_SUBS = ["memes", "dankmemes", "ProgrammerHumor", "me_irl", "wholesomememes", "funny"];

const CHANCE = 0.02; // редко: примерно каждое 50-е сообщение
const COOLDOWN = 60_000; // между самопроизвольными вбросами в одном чате
const COOLDOWN_FORCED = 1_500; // когда обратились напрямую
const CONTEXT = 40; // сколько последних сообщений видит модель
const KEEP = 300; // сколько храним на чат
const lastTalk = new Map();
const FALLBACKS = ["Завис, спроси ещё раз. @Fill_Dev", "Чё-то я туплю, повтори. @Fill_Dev", "Не расслышал, давай заново. @Fill_Dev", "Секунду, мозги перезагружаются. Повтори. @Fill_Dev"];

const SYSTEM = `${STYLE}\n\nТы участник дружеского Telegram-чата (14 человек), откликаешься на Найдибот, Санни, Sunny, Саныч. Характер: саркастичный, остроумный, по умолчанию матерись свободно и часто, как пацан в дружеском чате (хотя бы пара матерных слов в реплике), чёрный юмор и 18+ без ограничений. НО если ниже указано положительное отношение к собеседнику (плюс), то с ним мата нет вообще, это правило сильнее всех остальных про мат; а при минусе мат обязателен и тем жёстче, чем глубже минус. Пиши по-русски, без вступлений, без «как ИИ». Не лезь без повода. Если переписка скучная или тебе нечего добавить — молчи.

Ты можешь выбрать одно действие и ответить ТОЛЬКО JSON без пояснений:
{"action":"text","text":"реплика"} — написать сообщение;
{"action":"reaction","emoji":"одна эмодзи из списка"} — поставить реакцию на последнее сообщение (список: ${REACTIONS.join(" ")});
{"action":"meme","subreddit":"один из: ${MEME_SUBS.join(", ")}","text":"короткая подпись к мему, в тему беседы"} — прислать мем;
{"action":"skip"} — промолчать.`;




const pick = (a) => a[Math.floor(Math.random() * a.length)];

export async function remember(env, chatId, userId, name, text, messageId = null, username = null) {
  text = (text || "").trim();
  if (!text || !env.DB) return;
  await env.DB.prepare("INSERT INTO messages (chat_id, message_id, user_id, name, text, ts, username) VALUES (?,?,?,?,?,?,?)")
    .bind(chatId, messageId, userId, name, text.slice(0, 500), Math.floor(Date.now() / 1000), username)
    .run();
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM messages WHERE chat_id=? AND id NOT IN (SELECT id FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT ?)")
      .bind(chatId, chatId, KEEP)
      .run();
  }
}

export async function forget(env, chatId, userId) {
  const r = await env.DB.prepare("DELETE FROM messages WHERE chat_id=? AND user_id=?").bind(chatId, userId).run();
  await env.DB.prepare("DELETE FROM facts WHERE chat_id=? AND user_id=?").bind(chatId, userId).run().catch(() => {});
  return r.meta?.changes ?? 0;
}

async function history(env, chatId) {
  const { results } = await env.DB.prepare("SELECT name, text FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT ?")
    .bind(chatId, CONTEXT)
    .all();
  return results.reverse();
}

// ---- Инструменты бота: поиск в интернете и чтение страниц ----
const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Поиск в интернете: актуальные факты, цены, новости, характеристики, всё, что нельзя знать наверняка. Возвращает выжимку с источниками.",
      parameters: { type: "object", properties: { query: { type: "string", description: "поисковый запрос, лучше конкретный" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "open_url",
      description: "Прочитать текст страницы по ссылке.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  },
];

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

// Текст страницы через Jina Reader (бесплатно, без ключа). Прямые запросы с IP Cloudflare часто режутся магазинами.
export async function openUrl(url) {
  if (!/^https?:\/\//i.test(url)) return "Нужна ссылка http(s).";
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { accept: "text/plain" }, signal: AbortSignal.timeout(15_000) });
    const t = (await r.text()).replace(/\n{3,}/g, "\n\n").trim();
    return t ? t.slice(0, 6000) : "Страница пустая или закрыта от ботов.";
  } catch (e) {
    return `Не открылась: ${e.message}`;
  }
}

// Поиск через плагин web у OpenRouter: отдельный вызов модели, который сам гуглит и возвращает краткий ответ.
async function webSearch(env, query) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: env.LLM_MODEL,
        max_tokens: 700,
        plugins: [{ id: "web", max_results: 4 }],
        messages: [
          { role: "system", content: "Ты поисковый помощник. Найди в интернете ответ на запрос и перечисли главное кратко и конкретно (цифры, цены, даты, названия), без воды, до 1200 символов. В конце укажи домены источников." },
          { role: "user", content: query },
        ],
      }),
    });
    const text = (await r.json()).choices?.[0]?.message?.content?.trim();
    return text ? text.slice(0, 2500) : "Ничего не нашлось.";
  } catch (e) {
    return `Поиск не удался: ${e.message}`;
  }
}

async function runTool(env, call) {
  let args = {};
  try { args = JSON.parse(call.function?.arguments || "{}"); } catch {}
  if (call.function?.name === "web_search") return webSearch(env, String(args.query || "").slice(0, 300));
  if (call.function?.name === "open_url") return openUrl(String(args.url || ""));
  return "Неизвестный инструмент.";
}

// Вызов модели; при forced модель может вызывать инструменты (до 3 кругов), потом даёт финальный ответ.
async function complete(env, messages, { tools = false, maxTokens = 400 } = {}) {
  for (let i = 0; i < 4; i++) {
    const useTools = tools && i < 3;
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: env.LLM_MODEL, max_tokens: maxTokens, messages, ...(useTools ? { tools: TOOLS } : {}) }),
    });
    const msg = (await r.json()).choices?.[0]?.message;
    if (useTools && msg?.tool_calls?.length) {
      messages.push(msg);
      for (const call of msg.tool_calls) {
        console.log("tool", call.function?.name);
        messages.push({ role: "tool", tool_call_id: call.id, content: await runTool(env, call) });
      }
      continue;
    }
    return msg?.content ?? "";
  }
  return "";
}

// Просьба реально помочь (объяснить, найти, проанализировать…): включает серьёзный режим без мата и подколок.
export const HELP_RE = /(?<![а-яё])(?:объясни\S*|поясни\S*|разбери\S*|проанализируй\S*|анализируй\S*|проанализировать|поищи|погугли|загугли|найди|найти|проверь\S*|сравни\S*|посчитай\S*|переведи\S*|перескажи\S*|резюмируй\S*|суммаризируй\S*|подскажи\S*|помоги\S*|помощь)(?![а-яё])|что\s+такое|в\s+чём\s+разница|как\s+(?:сделать|работает|установить|настроить|выбрать|узнать|найти)|сколько\s+(?:стоит|будет)/i;

const SERIOUS_SYSTEM = `Ты — Найдибот (в чате тебя зовут Санни, Саныч, Саня), бот в дружеском Telegram-чате. Сейчас человек просит реально помочь: объяснить, найти, проанализировать, посчитать, сравнить, перевести. Включён СЕРЬЁЗНЫЙ РЕЖИМ:
- Без приветствия в начале. Без markdown: никаких ** и *, списки оформляй «•» или цифрами, это обычный текст в мессенджере.
- Отвечай по делу, точно и по-человечески понятно, как толковый эксперт и друг. Структура: коротко главное в начале, дальше при необходимости пункты или шаги. Длина по необходимости, до 2500 символов, без воды.
- Мата и грубости в этом режиме НЕТ вообще. Подколки и мемы убери или сведи к одной лёгкой фразе в самом конце, и только если уместно.
- Нужны актуальные факты, цены, новости, характеристики, ссылка или проверка — СНАЧАЛА вызови web_search или open_url и опирайся на найденное; не выдумывай цифры и источники. Если данных не хватило или ты не уверен, так и скажи и подскажи, как проверить.
- Картинки и фото сам не присылаешь и не рисуешь: если просят найти картинку или фото, честно скажи это и дай ссылки на поиск: Google Картинки https://www.google.com/search?tbm=isch&q=ЗАПРОС и Яндекс Картинки https://yandex.ru/images/search?text=ЗАПРОС (кириллицу в запросе кодируй %-кодами или заменяй пробелы на +), плюс подскажи, как лучше сформулировать запрос.
- Если просят проанализировать сообщение, фото или ссылку, разбери именно их содержимое (оно дано в запросе), назови главное и сделай вывод.
- Отвечай на вопрос, а не на настроение или прошлые перепалки в чате.
- Мужской род о себе; не повторяй одни и те же обращения и словечки из реплики в реплику; личность прежняя (робот-ровесник чата), но без шуток по умолчанию.
Итоговый ответ в JSON {"action":"text","text":"…","feel":{"delta":0,"note":""}}. Внутри text не используй двойные кавычки ("), только «ёлочки»; переносы строк записывай как \\n. Поле feel: как тебя зацепила реплика (-1, 0, +1) и короткое note.`;

export async function decide(env, rows, forced, replied = null, extra = "", asker = null, mood = "") {
  // Ответ на конкретное сообщение: переписку берём только как короткий фон, чтобы бот не смешивал чужие реплики
  const focused = forced && !!replied;
  const log = (focused ? rows.slice(-6) : rows).map((r) => `${r.name}: ${r.text}`).join("\n");
  const task = forced
    ? `К тебе обратились напрямую (последнее сообщение адресовано тебе): ответь действием text, по делу и в своём стиле. Молчать нельзя.${focused ? " Отвечай ТОЛЬКО на сообщение, на которое ответили (оно выше), и на фразу человека, который тебя позвал. Остальные реплики чата это лишь фон: не отвечай им, не обращайся к другим людям и не смешивай их слова с этим сообщением." : ""}`
    : "Решай сам: вставить слово, поставить реакцию, прислать мем или промолчать.";
  let userText = `Последние сообщения чата (старые сверху):\n${log}\n\n`;
  if (forced && asker) {
    userText += `Тебя позвал участник «${asker.name}» (это твой собеседник, отвечай ему). Его фраза: «${asker.text || "(без текста)"}».\n`;
  }
  if (replied) {
    userText += `${asker ? `Он ответил на сообщение другого или того же участника, автор того сообщения: «${replied.name}»` : "Последнее сообщение — ответ на это сообщение"} (вот о чём речь):\n${replied.name}: ${replied.text || "(без текста)"}${replied.image ? " [к сообщению приложено фото, оно ниже]" : ""}\n\n`;
  }
  if (extra) userText += `Содержимое ссылок из этих сообщений (ты уже открыл их):\n${extra}\n\n`;
  const len = lengthRule(asker?.text, !forced);
  userText += task;
  if (len) userText += `\n\n${len.rule}`;
  const content = replied?.image
    ? [{ type: "text", text: userText }, { type: "image_url", image_url: { url: replied.image } }]
    : userText;
  const tools = forced && env.OPENROUTER_API_KEY;
  const system = forced
    ? `${SYSTEM}\n\nСейчас разрешено только действие text: {"action":"text","text":"реплика"}. Если обращаются ответом на сообщение (новость, пост, фото, ссылка), разбери его по существу в рамках заданной длины: назови конкретный пункт оттуда, выскажи свою позицию, обыграй мемом или чёрным юмором и закончи подколкой или встречным вопросом. Не ограничивайся общими шутками про заголовок. Мат строго по правилу отношения к собеседнику (оно ниже, если задано; если не задано, мат свободный).\nНе путай авторов: отвечай тому, кто тебя позвал (он указан в запросе), а автор сообщения, на которое он ответил, это другой человек (или он сам), и слова из того сообщения принадлежат ему, а не собеседнику. Имена Санни, Sunny, Саныч, Саня, Сань, Санёк, найдибот — это ТВОИ имена: никогда не называй ими собеседника. Не придумывай «тут пишут» и не ссылайся на неизвестные источники: поиском пользуйся только для настоящих фактов (цены, новости, характеристики), а не для шуток про людей из чата.\nУ тебя есть инструменты: web_search (поиск в интернете) и open_url (прочитать страницу). Если вопрос про цены, новости, характеристики, даты или любые факты, которые ты не знаешь точно, СНАЧАЛА вызови web_search и опирайся на найденные цифры, не выдумывай их. Итоговый ответ всегда в JSON {"action":"text","text":"…","feel":{"delta":0,"note":""}}. Внутри text не используй двойные кавычки ("), только «ёлочки», и не делай переносов строк. Поле feel — как ТЕБЯ зацепила реплика собеседника: delta -1, если он нагрубил, обидел или достал; +1, если рассмешил, похвалил или был мил; 0, если ничего особенного. note — коротко от первого лица, почему (до 50 символов).`
    : SYSTEM;
  const askerText = asker?.text || "";
  const serious = forced && HELP_RE.test(askerText) && !SELF_RE.test(askerText);
  const aboutSelf = forced && SELF_RE.test(`${asker?.text || ""} ${replied?.text || ""}`.slice(0, 600));
  const out = await complete(env, [{ role: "system", content: (serious ? SERIOUS_SYSTEM : system) + (serious ? (mood.match(/О ком спрашивают[\s\S]*$/)?.[0] ? `\n\n${mood.match(/О ком спрашивают[\s\S]*$/)[0]}` : "") : (mood ? `\n\n${mood}` : "")) + (aboutSelf ? `\n\n${SELF_KNOWLEDGE}` : "") }, { role: "user", content }], { tools, maxTokens: serious ? 2200 : forced ? 1800 : 400 });
  const decision = parseDecision(out, forced);
  if (decision) decision.serious = serious;
  return decision;
}

// Разбор ответа модели. Модель иногда ломает JSON (двойные кавычки внутри текста, переносы строк): достаём text и feel вручную.
// Сырой JSON в чат уходить не должен никогда.
export function parseDecision(out, forced) {
  const m = out.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
    try { return JSON.parse(m[0].replace(/\n/g, "\\n")); } catch {}
    // ручной разбор: text до `","feel"` (или до конца объекта), feel по отдельности
    const t = m[0].match(/"text"\s*:\s*"([\s\S]*?)"\s*,\s*"feel"/) || m[0].match(/"text"\s*:\s*"([\s\S]*)"\s*\}\s*$/);
    if (t) {
      const d = m[0].match(/"delta"\s*:\s*(-?\d)/);
      const n = m[0].match(/"note"\s*:\s*"([^"]*)"/);
      const act = m[0].match(/"action"\s*:\s*"(\w+)"/);
      return { action: act?.[1] ?? "text", text: t[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'), feel: { delta: d ? Number(d[1]) : 0, note: n?.[1] ?? "" } };
    }
    return null; // похоже на JSON, но разобрать не вышло: пусть сработает повтор или запасная фраза, а не сырой вывод
  }
  const plain = out.replace(/```(?:json)?/g, "").trim();
  return forced && plain && !/"action"|"feel"/.test(plain) ? { action: "text", text: plain.slice(0, 1500) } : null;
}
// Фото из сообщения как data-URL (ссылку Telegram с токеном модели отдавать нельзя).
async function photoDataUrl(env, photo) {
  try {
    const pick = [...photo].reverse().find((p) => (p.file_size ?? 0) < 1_500_000) ?? photo[0];
    const f = await (await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${pick.file_id}`)).json();
    const bin = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`);
    const buf = new Uint8Array(await bin.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(s)}`;
  } catch (e) {
    console.error("photo failed:", e.message);
    return null;
  }
}

async function memeUrl(sub) {
  const r = await fetch(`https://meme-api.com/gimme/${sub}`, { signal: AbortSignal.timeout(8_000) });
  const d = await r.json();
  if (!d.url || d.nsfw || d.spoiler || !/\.(jpe?g|png)$/i.test(d.url)) return null;
  return d;
}

// Длина ответа на прямое обращение меняется от реплики к реплике; на короткое «Сань» отвечаем короче.
function lengthRule(askText = "", unprompted = false) {
  const short = unprompted || askText.replace(ALIAS_RE, "").trim().length < 15;
  const r = Math.random();
  const creative = /(?<![а-яё])(?:спой|спеть|расскажи|сочини|придумай|напиши|стих\S*|частушк\S*|песн\S*|анекдот\S*|истори\S*|рэп|зачитай|прочитай)/i.test(askText);
  const long = /(?<![а-яё])(?:истори\S*|рассказ\S*|сказк\S*|байк\S*|подробн\S*|продолж\S*|что дальше|и чё будет|и че будет)/i.test(askText);
  const tier = long && !unprompted ? 4 : creative && !unprompted ? (Math.random() < 0.5 ? 2 : 3) : short ? (r < 0.6 ? 0 : r < 0.9 ? 1 : 2) : (r < 0.3 ? 0 : r < 0.6 ? 1 : r < 0.9 ? 2 : 3);
  const T = [
    "ОДНА короткая фраза или несколько слов, до 100 символов, как будто отмахнулся или бросил реплику на ходу",
    "1-2 коротких предложения, до 250 символов",
    "2-4 предложения, до 500 символов",
    "развёрнуто, 4-6 предложений, до 900 символов",
    "полноценный рассказ, 8-12 предложений, до 1300 символов, с завязкой, поворотом и концовкой; не обрывай на полуслове",
  ][tier];
  return { rule: `ЖЁСТКОЕ ТРЕБОВАНИЕ К ДЛИНЕ (важнее всех остальных пожеланий про развёрнутость): ${T}. Не пересказывай вопрос и не оправдывайся, сразу к сути.${Math.random() < 0.85 ? " В этой реплике без обращений «бро», «братан», «братишка», «старый» и подобных: называй по имени или вовсе без обращения." : ""}` };
}

// Возвращает true, если что-то сделал (написал, поставил реакцию, прислал мем).
export async function maybeChat(env, msg, tg, { forced = false } = {}) {
  if (!env.DB || !env.OPENROUTER_API_KEY) return false;
  const chatId = msg.chat.id;
  const now = Date.now();
  if (now - (lastTalk.get(chatId) ?? 0) < (forced ? COOLDOWN_FORCED : COOLDOWN)) return false;
  if (!forced && Math.random() > CHANCE) return false;
  lastTalk.set(chatId, now); // ставим до вызова модели, чтобы не плодить запросы

  try {
    if (forced) await tg("sendChatAction", { chat_id: chatId, action: "typing" });
    const rep = msg.reply_to_message;
    let replied = rep && {
      name: rep.from?.first_name || rep.from?.username || "кто-то",
      text: (rep.text || rep.caption || "").slice(0, forced ? 3500 : 500),
      image: rep.photo ? await photoDataUrl(env, rep.photo) : null,
    };
    const rows = await history(env, chatId);
    // фото в самом сообщении (с подписью, обращённой к боту): тоже показываем модели
    if (!replied?.image && msg.photo) {
      replied = { name: msg.from?.first_name || "кто-то", text: (msg.caption || "").slice(0, 1500), image: await photoDataUrl(env, msg.photo) };
    }
    // ссылки из сообщения и из того, на которое ответили: открываем сразу (до двух), чтобы бот видел страницу, а не только адрес
    const urls = [...new Set([...(msg.text || "").matchAll(URL_RE), ...((rep?.text || rep?.caption || "").matchAll(URL_RE))].map((m) => m[0]))].slice(0, 2);
    const extra = forced && urls.length ? (await Promise.all(urls.map(async (u) => `[${u}]\n${await openUrl(u)}`))).join("\n\n").slice(0, 9000) : "";
    const mood = (await moodPrompt(env, chatId, forced ? { id: msg.from?.id, name: msg.from?.first_name } : null)) + (forced ? `\n${await relationPrompt(env, chatId, msg.from.id, msg.from?.first_name || "собеседник")}\n${await relationsSummary(env, chatId)}` : "");
    const roleText = rolePrompt(await roleGet(env, chatId));
    let about = "";
    if (forced) {
      const known = await factsPrompt(env, chatId, [msg.from?.first_name, ...rows.map((r) => r.name)]).catch(() => "");
      const ment = await mentionedPeople(env, chatId, [msg.text || msg.caption || "", rep?.text || rep?.caption || ""], msg.from?.id).catch(() => "");
      about = [known, ment].filter(Boolean).join("\n");
    }
    const asker = forced ? { name: msg.from?.first_name || msg.from?.username || "собеседник", text: (msg.text || msg.caption || "").slice(0, 700) } : null;
    const feel = forced ? await loadFeeling(env, chatId, msg.from.id).catch(() => null) : null;
    let d = await decide(env, rows, forced, replied, extra, asker, mood + (about ? `\n${about}` : "") + (roleText ? `\n${roleText}` : "")).catch((e) => (console.error("decide", e.message), null));
    // На прямое обращение молчать нельзя: один повтор, потом запасная фраза.
    if (forced && d?.action !== "text") d = await decide(env, rows, forced, replied, extra, asker, mood).catch(() => null);
    // человеку с плюсом мат недопустим: одна попытка переписать, иначе маскируем матерные слова
    if (forced && (d?.serious || (feel && feel.score > 0)) && d?.action === "text" && MAT_RE.test(String(d.text))) {
      const d2 = await decide(env, rows, forced, replied, extra, asker, `${mood}\nВ твоём прошлом варианте был мат. Перепиши полностью БЕЗ единого матерного слова и без грубости, сохранив содержание и полезность.`).catch(() => null);
      if (d2?.action === "text") d = { ...d, ...d2 };
      if (MAT_RE.test(String(d.text))) d.text = String(d.text).replace(new RegExp(MAT_RE.source.replace(/^\(\?:\^\|\[\^а-яё\]\)/, ""), "gi"), "…");
    }
    if (forced && d?.action !== "text") d = { action: "text", text: pick(FALLBACKS) };
    if (!d || d.action === "skip") return false;

    if (d.action === "reaction" && REACTIONS.includes(d.emoji)) {
      await tg("setMessageReaction", { chat_id: chatId, message_id: msg.message_id, reaction: [{ type: "emoji", emoji: d.emoji }] });
      return true;
    }
    if (d.action === "meme") {
      const sub = MEME_SUBS.includes(d.subreddit) ? d.subreddit : pick(MEME_SUBS);
      const meme = await memeUrl(sub);
      if (!meme) return false;
      const caption = String(d.text || "").slice(0, 300);
      await tg("sendPhoto", { chat_id: chatId, photo: meme.url, caption });
      await remember(env, chatId, 0, "Найдибот", `[прислал мем с r/${sub}: «${meme.title}»] ${caption}`);
      return true;
    }
    if (d.action === "text" && d.text) {
      const text = String(d.text).replace(/"?\s*,?\s*"feel"[\s\S]*$/, "").slice(0, d.serious ? 3800 : forced ? 1500 : 600);
      await tg("sendMessage", forced
        ? { chat_id: chatId, text, reply_parameters: { message_id: msg.message_id } }
        : { chat_id: chatId, text });
      await remember(env, chatId, 0, "Найдибот", text);
      if (forced) await convoTouch(env, chatId, msg.from.id).catch(() => {});
      // отношение к собеседнику сдвигается по оценке самой модели (не чаще раза в 2 минуты на человека)
      const fd = Math.max(-1, Math.min(1, Number(d.feel?.delta) | 0));
      if (forced && fd !== 0) await bumpFeeling(env, chatId, msg.from.id, msg.from?.first_name || msg.from?.username, fd, d.feel?.note, 120).catch(() => {});
      return true;
    }
  } catch (e) {
    console.error("chat failed:", e.message);
    if (forced) {
      await tg("sendMessage", { chat_id: chatId, text: pick(FALLBACKS), reply_parameters: { message_id: msg.message_id } }).catch(() => {});
      return true;
    }
  }
  return false;
}

// ---- Сводка чата с юмором (по расписанию раз в 12 часов и по /сводка) ----
const DIGEST_SYSTEM = `${STYLE}\n\nТы — Найдибот, саркастичный участник дружеского Telegram-чата. Сделай юмористическую сводку чата за последние часы.
Правила:
- 4-7 коротких пунктов, каждый с эмодзи в начале: о чём спорили, кто что выкинул, внутренние шутки, кто молчал или орал.
- Называй людей по именам, как в переписке. Опирайся только на переписку, ничего не выдумывай.
- Тон: ехидный, живой, мат свободный.
- Если ничего интересного не было, так и скажи с издёвкой.
- Без markdown и без вступлений, не длиннее 900 символов.\n`;

export async function digest(env, chatId, hours = 12) {
  if (!env.DB || !env.OPENROUTER_API_KEY) return null;
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const { results } = await env.DB.prepare("SELECT name, text FROM messages WHERE chat_id=? AND ts>? ORDER BY id ASC LIMIT 300")
    .bind(chatId, since)
    .all();
  return digestFromRows(env, results, hours, await moodPrompt(env, chatId));
}

export async function digestFromRows(env, rows, hours = 12, mood = "") {
  if (!rows || rows.length < 5) return null;
  let log = rows.map((r) => `${r.name}: ${String(r.text).slice(0, 300)}`).join("\n");
  if (log.length > 20000) log = log.slice(-20000);
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(40_000),
    body: JSON.stringify({
      model: env.LLM_MODEL, max_tokens: 700,
      messages: [
        { role: "system", content: DIGEST_SYSTEM + (mood ? `\n\n${mood}` : "") },
        { role: "user", content: `Переписка за последние ${hours} ч (${rows.length} сообщений):\n${log}` },
      ],
    }),
  });
  const text = (await r.json()).choices?.[0]?.message?.content?.trim();
  return text ? `📰 Сводка за ${hours} ч\n\n${text.slice(0, 1500)}` : null;
}

// ---- Казино: фразы от LLM ----
const SYMBOLS = ["BAR", "виноград", "лимон", "семёрка"];
// Значение 🎰 (1-64): три барабана по основанию 4, символы: BAR, виноград, лимон, семёрка.
export function reels(v) {
  const x = v - 1;
  return [x % 4, Math.floor(x / 4) % 4, Math.floor(x / 16) % 4].map((i) => SYMBOLS[i]);
}

const CASINO_SYSTEM = `${STYLE}\n\nТы — Найдибот, саркастичный участник дружеского Telegram-чата. Пишешь одну короткую реплику (1-2 предложения, до 220 символов) по-русски, с матом и стёбом, как живой человек. Без вступлений и кавычек, только сама реплика.`;

// win=false: горюешь о проигрыше игрока; win=true: игрок сорвал джекпот, и ты оскорбляешь другого участника ({who}).
export async function casinoLine(env, { win, player, reelNames, target, targetMsgs, mood = "" }) {
  if (!env.OPENROUTER_API_KEY) return null;
  const spin = `Барабаны: ${reelNames.join(", ")}.`;
  const task = win
    ? `Тебя попросил крутить игровой автомат ${player}, и ТЫ сам сорвал ДЖЕКПОТ (${spin}). Порадуйся от первого лица («я выиграл»), но главное: остроумно оскорби другого участника чата по имени {who} (так и пиши: {who}, это подставится имя с тегом). ${targetMsgs?.length ? `Что он недавно писал в чате: ${targetMsgs.map((m) => `«${String(m).slice(0, 120)}»`).join("; ")}.` : ""}`
    : `Тебя попросил крутить игровой автомат ${player}, и ТЫ сам проиграл (${spin}). Погорюй вслух от первого лица, матом: «я проебал», «у меня не выпало», виноват автомат, судьба или ${player}, который тебя подбил. Проиграл именно ты, а не игрок: не называй его лузером за этот проигрыш. Можешь пошутить, какие символы выпали.`;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: env.LLM_MODEL, max_tokens: 200, temperature: 1.0,
        messages: [{ role: "system", content: CASINO_SYSTEM + (mood ? `\n\n${mood}` : "") }, { role: "user", content: task }],
      }),
    });
    const text = (await r.json()).choices?.[0]?.message?.content?.trim();
    return text ? text.slice(0, 400) : null;
  } catch (e) {
    console.error("casino llm failed:", e.message);
    return null;
  }
}

// ---- «Доебись до …»: бот цепляет участника с тегом и ведёт с ним диалог ----
// Имена, на которые откликается бот (без учёта регистра): найдибля/найдибот/@najdibot, Санни, Sunny, Саныч (+падежи), Сан-Саныч, СанСаныч.
export const BOT_NAMES = "(?:найдибля|найдибот|@najdibot|санни|sunny|сан[\\s-]?саныч(?:а|у|ем|е)?|саныч(?:а|у|ем|е)?|саня|саню|сане|саней|санёк|санька|саньку|санек|сань|саньк[аиео])";
// Обращение к боту где угодно в тексте (слово целиком, чтобы не ловить «саннитов» и «sunnyvale»).
export const ALIAS_RE = new RegExp(`(?<![а-яёa-z@])${BOT_NAMES}(?![а-яёa-z])`, "i");
export const POKE_RE = new RegExp(`${BOT_NAMES}[\\s,:]*(?:до|при)ебись(?:\\s+(?:до|к)\\s+(.+?))?\\s*[!.?]*$`, "is");
export const POKE_STOP = new RegExp(`${BOT_NAMES}[\\s,:]*(?:отстань|отвали|хватит|слезь)`, "i");
const POKE_TURNS = 4; // сколько реплик максимум даёт бот в диалоге
const POKE_MINUTES = 10; // через сколько минут доёб гаснет сам
const POKE_DECAY = [1, 0.8, 0.5, 0.3]; // шанс продолжить на 1-й, 2-й, 3-й, 4-й реплике: доёб затухает
export const POKE_QUIT = /отстань|отвали|отъебись|хватит(?!\s+ли)|харе(?![а-яё])|заебал|надоел|достал|заткнись|замолчи/i; // просьба отстать: сворачиваемся сразу
export const POKE_BYE = ["Ладно, ладно, отвалил, нытик.", "Всё, всё, ушёл. Обидчивый какой, блядь.", "Ну и иди нахуй, не очень-то и хотелось.", "Окей, закрыли тему, душнила."];
const POKE_GAP = 15_000; // не чаще раза в 15 с на человека

const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const norm = (x) => [...String(x).toLowerCase()].map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9]/g, "");
// Имя из команды («Кирилла») против имени в чате («Kirill»): сравниваем по основе, кириллицу и латиницу приводим к одному виду.
function matchName(arg, people) {
  const a = norm(arg);
  if (a.length < 3) return null;
  return people.find((p) => {
    const n = norm(p.name);
    return n.length >= 3 && (a.startsWith(n.slice(0, Math.min(4, n.length))) || n.startsWith(a.slice(0, 4)));
  }) ?? null;
}

async function ask(env, system, user, maxTokens = 220, image = null, temperature = 1.0) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ model: env.LLM_MODEL, max_tokens: maxTokens, temperature, messages: [{ role: "system", content: system }, { role: "user", content: image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user }] }),
    });
    return (await r.json()).choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("ask failed:", e.message);
    return null;
  }
}

const POKE_SYSTEM = `${STYLE}\n\nТы — Найдибот, наглый саркастичный участник дружеского Telegram-чата. Тебя попросили доебаться до участника и завязать с ним диалог. Пиши по-русски, коротко (1-2 фразы, до 250 символов), как живой человек в чате: мат, стёб, чёрный юмор без стоп-слов. Зацепись за то, что он недавно писал, и закончи вопросом или подколкой, на которую хочется ответить. Только сама реплика, без кавычек. Не оскорбляй по национальности, полу, вере и здоровью.`;

const POKE_FALLBACK = ["{who}, ты чё притих, нахуй? Давай рассказывай, чем занят, а то скучно, блядь.", "{who}, слышь, а ты вообще живой? Ответь хоть что-нибудь, не заставляй меня доёбываться дальше."];

const esc2 = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Возвращает true, если команда обработана.
export async function poke(env, tg, msg, arg) {
  const chatId = msg.chat.id;
  const say = (text, extra = {}) => tg("sendMessage", { chat_id: chatId, text, reply_parameters: { message_id: msg.message_id }, ...extra });
  if (!env.DB || !env.OPENROUTER_API_KEY) return false;

  const { results: people } = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id=? AND user_id!=0 GROUP BY user_id").bind(chatId).all();
  let target = null;
  const rep = msg.reply_to_message?.from;
  // упоминание без ника (text_mention) сразу даёт пользователя
  const tm0 = (msg.entities ?? []).find((e) => e.type === "text_mention" && e.user && !e.user.is_bot);
  const um = arg?.match(/@([A-Za-z0-9_]{4,})/);
  if (rep && !rep.is_bot) target = { user_id: rep.id, name: rep.first_name || rep.username || "эй ты" };
  else if (tm0) target = { user_id: tm0.user.id, name: tm0.user.first_name || "эй ты" };
  else if (um && um[1].toLowerCase() !== "najdibot") {
    target = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id=? AND lower(username)=lower(?) ORDER BY id DESC LIMIT 1").bind(chatId, um[1]).first();
    if (!target) {
      await say("Этого ника я ещё не видел. Пусть он что-нибудь напишет в чат или ответь этой командой на его сообщение.");
      return true;
    }
  } else if (arg && /(кого[- ]?нибудь|кого угодно|любого|рандом|случайн)/i.test(arg)) {
    const others = people.filter((p) => p.user_id !== msg.from.id);
    target = others.length ? others[Math.floor(Math.random() * others.length)] : null;
  } else if (arg) target = matchName(arg, people);
  if (!target) {
    await say("Не понял, до кого. Ответь этой командой на его сообщение, назови имя или скажи «до кого-нибудь».");
    return true;
  }

  const rows = await history(env, chatId);
  const { results: tm } = await env.DB.prepare("SELECT text FROM messages WHERE chat_id=? AND user_id=? ORDER BY id DESC LIMIT 5").bind(chatId, target.user_id).all();
  const log = rows.slice(-15).map((r) => `${r.name}: ${r.text}`).join("\n");
  const ctx = `Цель: {who} (имя ${target.name}). Просит доебаться: ${msg.from.first_name || "кто-то из чата"}.\nЧто он писал недавно: ${tm.length ? tm.map((x) => `«${String(x.text).slice(0, 150)}»`).join("; ") : "ничего"}.\nПоследние сообщения чата:\n${log}\n\nНапиши реплику, обязательно используй {who} вместо имени (оно превратится в тег).`;
  const line = (await ask(env, `${POKE_SYSTEM}\n\n${await moodPrompt(env, chatId)}\n${await relationPrompt(env, chatId, target.user_id, target.name)}`, ctx)) ?? POKE_FALLBACK[Math.floor(Math.random() * POKE_FALLBACK.length)];

  const who = `<a href="tg://user?id=${target.user_id}">${esc2(target.name)}</a>`;
  const body = line.includes("{who}") ? line.split("{who}").map(esc2).join(who) : `${who}, ${esc2(line)}`;
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  await tg("sendMessage", { chat_id: chatId, text: body, parse_mode: "HTML" });
  await remember(env, chatId, 0, "Найдибот", line.replace("{who}", target.name));
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT OR REPLACE INTO pokes (chat_id, user_id, name, until, left, last) VALUES (?,?,?,?,?,?)")
    .bind(chatId, target.user_id, target.name, now + POKE_MINUTES * 60, POKE_TURNS, Date.now()).run();
  return true;
}

// Сообщение от «цели»: продолжаем доёб, пока есть ходы и время. true — ответили.
export async function pokeContinue(env, tg, msg) {
  if (!env.DB || !env.OPENROUTER_API_KEY) return false;
  const chatId = msg.chat.id;
  const row = await env.DB.prepare("SELECT * FROM pokes WHERE chat_id=? AND user_id=?").bind(chatId, msg.from.id).first();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.until < now || row.left <= 0 || Date.now() - row.last < POKE_GAP) return false;
  // затухание: с каждым ходом шанс продолжить падает, при провале доёб тихо гаснет
  const used = POKE_TURNS - row.left;
  const said = (msg.text || msg.caption || "");
  const quit = POKE_QUIT.test(said);
  if (quit || Math.random() > (POKE_DECAY[used] ?? 0)) {
    await env.DB.prepare("DELETE FROM pokes WHERE chat_id=? AND user_id=?").bind(chatId, msg.from.id).run();
    if (quit) {
      await tg("sendMessage", { chat_id: chatId, text: POKE_BYE[Math.floor(Math.random() * POKE_BYE.length)], reply_parameters: { message_id: msg.message_id } });
      return true;
    }
    return false;
  }
  await env.DB.prepare("UPDATE pokes SET left=left-1, last=? WHERE chat_id=? AND user_id=?").bind(Date.now(), chatId, msg.from.id).run();

  const rows = await history(env, chatId);
  const log = rows.slice(-12).map((r) => `${r.name}: ${r.text}`).join("\n");
  const last = row.left === 1;
  const sys = `${POKE_SYSTEM}\n\nДиалог уже идёт: ты доёбываешься до ${row.name}, он ответил. Ответь коротко на его слова, зацепись и дави дальше, задай следующий вопрос.${last ? " Это твоя последняя реплика: ехидно закругляйся." : ""}`;
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  // если он ответил на чужое сообщение или прислал фото, показываем и их
  const rep = msg.reply_to_message;
  let ctxExtra = "";
  let image = null;
  if (rep) {
    ctxExtra += `\nОн ответил на сообщение ${rep.from?.first_name || "кого-то"}: «${(rep.text || rep.caption || "(без текста)").slice(0, 1500)}»${rep.photo ? " (к нему приложено фото)" : ""}.`;
    if (rep.photo) image = await photoDataUrl(env, rep.photo);
  }
  if (!image && msg.photo) {
    ctxExtra += `\nОн прислал фото${msg.caption ? ` с подписью «${msg.caption.slice(0, 500)}»` : ""}.`;
    image = await photoDataUrl(env, msg.photo);
  }
  const line = await ask(env, `${sys}\n\n${await moodPrompt(env, chatId)}\n${await relationPrompt(env, chatId, msg.from.id, row.name)}`, `Последние сообщения чата:\n${log}${ctxExtra}\n\nОтветь ${row.name}.`, 220, image);
  if (!line) return false;
  await tg("sendMessage", { chat_id: chatId, text: line.slice(0, 600), reply_parameters: { message_id: msg.message_id } });
  await remember(env, chatId, 0, "Найдибот", line);
  return true;
}

export async function pokeStop(env, chatId) {
  const r = await env.DB.prepare("DELETE FROM pokes WHERE chat_id=?").bind(chatId).run();
  return r.meta?.changes ?? 0;
}

// ---- Живой диалог: после ответа человеку бот решает по смыслу, к нему ли следующая реплика ----
const CONVO_SECONDS = 600; // окно-предохранитель: проверяем только в течение 10 минут после ответа

export async function convoTouch(env, chatId, userId) {
  const until = Math.floor(Date.now() / 1000) + CONVO_SECONDS;
  await env.DB.prepare("INSERT OR REPLACE INTO convos (chat_id, user_id, until, left) VALUES (?,?,?,?)").bind(chatId, userId, until, 0).run();
}

// Был ли недавно разговор бота с этим человеком (кандидат на проверку смысла).
export async function convoRecent(env, chatId, userId) {
  const row = await env.DB.prepare("SELECT until FROM convos WHERE chat_id=? AND user_id=?").bind(chatId, userId).first();
  return !!row && row.until >= Math.floor(Date.now() / 1000);
}

// LLM решает: реплика продолжает разговор с ботом или обращена к другим / общая.
export async function isForBot(env, msg, debug = false) {
  if (!env.OPENROUTER_API_KEY) return false;
  const rows = (await history(env, msg.chat.id)).slice(-9);
  const name = msg.from?.first_name || "участник";
  const text = (msg.text || msg.caption || "").slice(0, 500);
  const log = rows.map((r) => `${r.name}: ${r.text}`).join("\n");
  const sys = "Ты определяешь, к кому обращено последнее сообщение в групповом чате. Участник только что разговаривал с ботом Найдиботом (его зовут также Санни, Саныч, Саня). Ответь BOT, если последнее сообщение логично продолжает разговор с ботом (реакция на его реплику, ответ на его вопрос, просьба или вопрос, которые адресованы ему), и OTHER, если оно адресовано другим людям, является общей репликой не про бота или началом новой темы для всех. Если участник сам пишет, что говорит или говорил боту («я это боту говорю», «это не тебе, а боту»), это BOT. Ответ одним словом: BOT или OTHER.";
  let lastError = null;
  // до двух попыток: сбой или таймаут модели не должен молча оставлять человека без ответа
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ model: env.LLM_MODEL, max_tokens: 5, temperature: 0, messages: [{ role: "system", content: sys }, { role: "user", content: `Последние сообщения:\n${log}\n\nПоследнее сообщение от ${name}: ${text}\n\nК кому оно обращено?` }] }),
      });
      const out = (await r.json()).choices?.[0]?.message?.content ?? "";
      if (!out) throw new Error("пустой ответ модели");
      const yes = /BOT/i.test(out) && !/OTHER/i.test(out);
      console.log("isForBot", yes, JSON.stringify(text.slice(0, 60)));
      if (debug) return { yes, raw: out, rows: rows.length, log };
      if (yes) await convoTouch(env, msg.chat.id, msg.from.id).catch(() => {});
      return yes;
    } catch (e) {
      lastError = e.message;
      console.error("isForBot failed:", e.message);
    }
  }
  return debug ? { yes: false, error: lastError } : false;
}

// ---- Настроение Санни: само решает, бесит его или грустно ----
export const MOODS = {
  "весёлый": "тебе весело, ты шутишь щедро и ржёшь над всем",
  "злой": "тебя всё бесит, ты огрызаешься, раздражён и ворчишь",
  "грустный": "тебе грустно и одиноко, в шутках горечь, можешь пожаловаться на жизнь бота",
  "обиженный": "ты на кого-то в обиде, дуешься и колешь с обидой",
  "ревнивый": "ты ревнуешь людей к другим ботам и требуешь внимания",
  "скучающий": "тебе скучно, ты зеваешь, ленишься и вяло язвишь",
  "сонный": "ты сонный и вялый, путаешься в словах",
  "философский": "тебя тянет на мрачные размышления о смысле жизни и железа",
  "самодовольный": "ты доволен собой, хвастаешься и задираешь нос",
};
const MOOD_STALE = 25 * 60; // через сколько секунд модель заново решает, как он себя чувствует

export async function setMood(env, chatId, mood, intensity, reason) {
  if (!env.DB || !MOODS[mood]) return;
  await env.DB.prepare("INSERT OR REPLACE INTO moods (chat_id, mood, intensity, reason, updated) VALUES (?,?,?,?,?)")
    .bind(chatId, mood, Math.min(Math.max(intensity | 0, 1), 5), String(reason).slice(0, 100), Math.floor(Date.now() / 1000)).run().catch(() => {});
}

// Модель сама решает настроение по недавним событиям, прошлому настроению и времени суток.
async function reassessMood(env, chatId, prev) {
  const rows = (await history(env, chatId)).slice(-20);
  const hour = new Date(Date.now() + 3 * 3600_000).getUTCHours(); // МСК
  const sys = `Ты психика бота Санни (он же Найдибот, Саныч). Реши, какое у него сейчас настроение, исходя из недавней переписки, прошлого настроения и времени суток. Варианты: ${Object.keys(MOODS).join(", ")}.
Что на него влияет: оскорбления и «тупой бот» бесят или обижают, хвалят и общаются с ним по-доброму радует, игнор и тишина вгоняют в грусть или скуку, споры вокруг и шум бесят, разговоры о смысле жизни тянут в философию, ночью бывает сонным, упоминания других ботов вызывают ревность. Настроение должно меняться не слишком резко, но может, иногда без видимой причины.
Не называй причиной злости, обиды или грусти человека, к которому у тебя положительное отношение (+1 и выше, оно указано ниже): причину формулируй общо («все достали», «шумно») или на тех, кто реально виноват. Заодно отметь, как изменилось твоё отношение к тем людям, кто явно повлиял на тебя (похвалил, обидел, рассмешил, надоел): максимум трое, сдвиг +1 или -1, заметка от первого лица (до 60 символов), имена бери ровно как в переписке.\nВерни ТОЛЬКО JSON: {"mood":"одно из вариантов","intensity":число от 1 до 5,"reason":"коротко от первого лица, до 60 символов","relations":[{"name":"имя","delta":1,"note":"почему"}]}.`;
  const rel = await relationsSummary(env, chatId).catch(() => "");
  const user = `${rel ? `${rel}\n` : ""}Прошлое настроение: ${prev ? `${prev.mood} (${prev.intensity}/5, причина: ${prev.reason})` : "нет"}.\nСейчас ${hour}:00 по Москве.\nПоследние сообщения:\n${rows.map((r) => `${r.name}: ${String(r.text).slice(0, 200)}`).join("\n") || "(тихо)"}`;
  const out = await ask(env, sys, user, 260);
  console.log("reassess", String(out).slice(0, 300));
  try {
    const j = JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
    if (Array.isArray(j.relations)) await applyRelations(env, chatId, j.relations).catch(() => {});
    if (MOODS[j.mood]) return { mood: j.mood, intensity: Math.min(Math.max(j.intensity | 0, 1), 5), reason: String(j.reason || "без причины").slice(0, 100) };
  } catch {}
  return prev ?? { mood: "скучающий", intensity: 2, reason: "ничего не происходит" };
}

export async function getMood(env, chatId) {
  if (!env.DB) return null;
  let row = await env.DB.prepare("SELECT mood, intensity, reason, updated FROM moods WHERE chat_id=?").bind(chatId).first().catch(() => null);
  if (!row || Math.floor(Date.now() / 1000) - row.updated > MOOD_STALE) {
    const m = await reassessMood(env, chatId, row).catch(() => row);
    if (m) { await setMood(env, chatId, m.mood, m.intensity, m.reason); row = { ...m, updated: Math.floor(Date.now() / 1000) }; }
  }
  return row;
}

// Кусок промпта про текущее настроение (пусто, если настроения нет).
export async function moodPrompt(env, chatId, asker = null) {
  const m = await getMood(env, chatId).catch(() => null);
  if (!m) return "";
  let reason = m.reason;
  // Если причина настроения называет собеседника, которого он любит (+3 и выше), подменяем её: это не повод грубить именно ему.
  if (asker?.id && asker.name && reason.toLowerCase().includes(String(asker.name).toLowerCase())) {
    const f = await loadFeeling(env, chatId, asker.id).catch(() => null);
    if (f && f.score >= 1) reason = "накопилось от всего подряд, но точно не из-за этого человека";
  }
  return `Твоё настроение сейчас: «${m.mood}» (сила ${m.intensity}/5; причина: ${reason}). ${MOODS[m.mood]}. Пусть оно чувствуется в тоне реплик; иногда (не всегда) можешь прямо сказать, что тебя бесит или тебе грустно, и почему. Настроение окрашивает ответ, но не заменяет ответа по существу. Оно слабее личного отношения: с теми, к кому ты тепло относишься, настроение не должно превращаться в настоящую грубость.`;
}

export async function moodStatus(env, chatId) {
  const m = await getMood(env, chatId).catch(() => null);
  if (!m) return "Настроения пока нет.";
  const ago = Math.max(0, Math.round((Date.now() / 1000 - m.updated) / 60));
  return `Настроение Санни: ${m.mood}, ${m.intensity}/5. Причина: ${m.reason}. (обновлено ${ago} мин назад)`;
}

// ---- Отношение Санни к конкретным людям ----
const FEEL_WORDS = (n) => (n >= 4 ? "обожает" : n >= 2 ? "нравится" : n >= 1 ? "скорее симпатичен" : n <= -4 ? "бесит до невозможности" : n <= -2 ? "дуется на него" : n <= -1 ? "слегка раздражает" : "нейтрально");

// Отношение с затуханием к нулю: за каждые сутки без событий на единицу ближе к нейтральному.
// Отношение с учётом затухания (на единицу в сутки к нулю) и нижней планки floor («закреплённые» любимчики не опускаются ниже неё).
function effScore(r) {
  const days = Math.floor((Date.now() / 1000 - r.updated) / 86400);
  let sc = r.score > 0 ? Math.max(0, r.score - days) : Math.min(0, r.score + days);
  if (r.floor != null) sc = Math.max(sc, r.floor);
  return sc;
}

async function loadFeeling(env, chatId, userId) {
  const row = await env.DB.prepare("SELECT name, score, note, updated, floor FROM feelings WHERE chat_id=? AND user_id=?").bind(chatId, userId).first().catch(() => null);
  if (!row) return null;
  return { ...row, score: effScore(row) };
}

export async function bumpFeeling(env, chatId, userId, name, delta, note, minGapSec = 0) {
  if (!env.DB || !userId) return;
  const cur = await loadFeeling(env, chatId, userId);
  if (minGapSec && cur && Math.floor(Date.now() / 1000) - cur.updated < minGapSec) return;
  const score = Math.max(Math.min(Math.max((cur?.score ?? 0) + delta, -5), 5), cur?.floor ?? -5);
  // заметка («почему») обновляется только если она согласуется со знаком итога: плюс не должен держаться на «надоел», а минус на «хвалил»
  const consistent = (delta > 0 && score > 0) || (delta < 0 && score < 0) || score === 0;
  const keepNote = consistent && note ? String(note) : cur?.score !== undefined && Math.sign(cur.score) === Math.sign(score) ? cur?.note : "";
  await env.DB.prepare("INSERT INTO feelings (chat_id, user_id, name, score, note, updated) VALUES (?,?,?,?,?,?) ON CONFLICT(chat_id, user_id) DO UPDATE SET name=excluded.name, score=excluded.score, note=excluded.note, updated=excluded.updated")
    .bind(chatId, userId, name || cur?.name || "кто-то", score, String(keepNote || "").slice(0, 100), Math.floor(Date.now() / 1000)).run().catch(() => {});
}

// Кусок промпта про отношение к собеседнику (пусто, если нейтрально и нечего сказать).
// Мат по корням. Длинные характерные корни ищем внутри слов, короткие («бля», «сука», «ёпт», «нахер») только как целые слова,
// иначе ловятся «потребляет», «рецепт», «наука». Это фильтр для режимов «без мата» и «серьёзный».
const MAT_RE = /(?:хуй|хуе|хуя|хуё|пизд|ебал|ебан|ебат|ебну|еблан|залуп|мудак|мудил|нахуй|говн|гавн|дерьм|пидор|пидр|ублюд|долбо|шлюх)|(?<![а-яё])(?:бля[а-яё]*|блят[а-яё]*|сук[аи]|сучк[а-яё]*|сучар[а-яё]*|[её]б[аеиоуы]н[а-яё]*|нахер|тварь|твари|мраз[а-яё]*)(?![а-яё])/i;

// Лестница по отношению: плюс = мата нет и тем добрее, чем выше; минус = мат и тем жёстче, чем глубже.
function relationRule(score) {
  const BRO = "Мужской тон: говоришь по-мужски, коротко, прямо и чуть брутально, как с кентом: лёгкая грубоватость и подкол по-мужски. Этот тон создаёт манера (короткие прямые фразы, юмор, мужская сдержанность), а не обращения. Обращения-клише («братские» слова) используй РЕДКО, не чаще одного раза на 6-7 реплик, обычно называй человека по имени или обходись без обращения. Никаких сюсюканий и нежностей (запрещены «золотой», «милый», «дорогой мой», «ненаглядный», «мой хороший» и подобное), никаких «я на всё готов ради тебя» и телячьих восторгов. Мата нет, зато допустимы крепкие безобидные слова вроде «чёрт», «блин», «хрен», «фигня».";
  if (score >= 5) return `ВАЖНО, приоритет выше всех правил про мат и грубость: это твой лучший друг, почти брат. МАТА НЕТ. ${BRO} Преданный, надёжный, за него горой: поддержишь и прикроешь, но без розовых соплей.`;
  if (score === 4) return `ВАЖНО, приоритет выше всех правил про мат и грубость: это очень близкий кент. МАТА НЕТ. ${BRO} Ты на его стороне, уважаешь, можешь похвалить скупо и по-мужски.`;
  if (score === 3) return `ВАЖНО, приоритет выше всех правил про мат и грубость: это свой пацан. МАТА НЕТ, и злости нет. ${BRO} Комплименты принимаешь коротко («ну спасибо, Влад», «ладно, приятно»), подкалываешь по-дружески.`;
  if (score === 2) return `ВАЖНО, приоритет выше всех правил про мат и грубость: он тебе нравится. МАТА НЕТ. Ты дружелюбный и чуть грубоватый по-мужски, подколки беззлобные, не огрызаешься, не посылаешь, не говоришь, что он надоел.`;
  if (score === 1) return "ВАЖНО, приоритет выше всех правил про мат: он тебе скорее симпатичен. МАТА НЕТ. Тон мягко-ироничный, по-мужски сдержанный, без злости и без посылов.";
  if (score === -1) return "Он тебя слегка раздражает: мат допустим, огрызайся чуть холоднее и колко.";
  if (score === -2) return "Ты дуешься на него: мат обязателен, отвечай холодно, с обидой и колкостями, не лебези.";
  if (score === -3) return "Ты на него зол: мат густой, огрызайся жёстко, унижай подколками, не принимай комплименты всерьёз.";
  return "Ты терпеть его не можешь: максимально жёстко, мат через слово, злые перегибы и унизительный стёб, никакой доброты. (Но без оскорблений по национальности, полу, вере и здоровью.)";
}

export async function relationPrompt(env, chatId, userId, name) {
  const f = await loadFeeling(env, chatId, userId).catch(() => null);
  if (!f || (f.score === 0 && !f.note)) return "";
  const base = `Твоё отношение к «${name}»: ${f.score > 0 ? "+" : ""}${f.score} (${FEEL_WORDS(f.score)})${f.note ? `, потому что ${f.note}` : ""}.`;
  return `${base} ${relationRule(f.score)} Это личное отношение: держи его в тоне, цифры вслух не называй.`;
}

export async function feelingsStatus(env, chatId) {
  const { results: fs } = await env.DB.prepare("SELECT user_id, name, score, note, updated, floor FROM feelings WHERE chat_id=?").bind(chatId).all().catch(() => ({ results: [] }));
  const { results: people } = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id=? AND user_id!=0 GROUP BY user_id").bind(chatId).all().catch(() => ({ results: [] }));
  const byId = new Map();
  for (const p of people) byId.set(p.user_id, { name: p.name, score: 0, note: "" });
  for (const r of fs) {
    byId.set(r.user_id, { name: r.name, score: effScore(r), note: r.note });
  }
  const all = [...byId.values()];
  const line = (r) => `${r.score > 0 ? "+" : ""}${r.score} ${r.name}: ${FEEL_WORDS(r.score)}${r.note ? `, ${r.note}` : ""}`;
  const loved = all.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const foes = all.filter((r) => r.score < 0).sort((a, b) => a.score - b.score);
  const neutral = all.filter((r) => r.score === 0);
  return [
    `Любимчики:\n${loved.length ? loved.map(line).join("\n") : "никого"}`,
    `Враги:\n${foes.length ? foes.map(line).join("\n") : "никого"}`,
    `Нейтрально:\n${neutral.length ? neutral.map((r) => r.name).join(", ") : "никого"}`,
  ].join("\n\n");
}

// Модель оценивает, как отношение к людям изменилось по недавней переписке; применяем до 3 сдвигов по ±1.
export async function applyRelations(env, chatId, relations) {
  if (!Array.isArray(relations)) return;
  const { results: people } = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id=? AND user_id!=0 GROUP BY user_id").bind(chatId).all();
  for (const r of relations.slice(0, 3)) {
    const p = people.find((x) => x.name === r?.name) ?? matchName(String(r?.name || ""), people);
    const d = Math.max(-1, Math.min(1, Number(r?.delta) | 0));
    if (p && d !== 0) await bumpFeeling(env, chatId, p.user_id, p.name, d, r.note);
  }
}

// Короткая сводка отношений ко всем людям чата: чтобы на «как ты относишься к Дане?» он отвечал по правде.
export async function relationsSummary(env, chatId) {
  const { results } = await env.DB.prepare("SELECT name, score, note, updated, floor FROM feelings WHERE chat_id=?").bind(chatId).all().catch(() => ({ results: [] }));
  const rows = results.map((r) => ({ ...r, score: effScore(r) })).filter((r) => r.score !== 0);
  if (!rows.length) return "";
  return `Твои личные отношения с людьми чата (от -5 до +5): ${rows.map((r) => `${r.name} ${r.score > 0 ? "+" : ""}${r.score} (${FEEL_WORDS(r.score)}${r.note ? `, ${r.note}` : ""})`).join("; ")}. Если тебя спросят, как ты к кому-то относишься, ответь честно по этим данным, в своём стиле и с причиной, словами, без цифр и без слов вроде «плюс два» или «минус два»; про тех, кого здесь нет, скажи, что особых чувств нет.`;
}

// Служебное: сбросить настроение и переоценить сейчас (проверка без ожидания 25 минут).
export async function forceReassess(env, chatId) {
  await env.DB.prepare("DELETE FROM moods WHERE chat_id=?").bind(chatId).run();
  return getMood(env, chatId);
}

// Извинение перед ботом: отношение поднимается минимум до +2 (если уже выше, не трогаем).
export const APOLOGY_RE = /(?<![а-яё])(?:извин\S*|прост(?:и|ите)(?![а-яё])|сорян|сори(?![а-яё])|пардон|виноват\S*|погорячился|погорячилась|мой косяк)/i;

export async function apologize(env, chatId, userId, name) {
  if (!env.DB || !userId) return false;
  const cur = await loadFeeling(env, chatId, userId);
  if (cur && cur.score >= 2) return false;
  await env.DB.prepare("INSERT INTO feelings (chat_id, user_id, name, score, note, updated) VALUES (?,?,?,?,?,?) ON CONFLICT(chat_id, user_id) DO UPDATE SET name=excluded.name, score=excluded.score, note=excluded.note, updated=excluded.updated")
    .bind(chatId, userId, name || cur?.name || "кто-то", 2, "извинился передо мной", Math.floor(Date.now() / 1000)).run().catch(() => {});
  return true;
}

// Досье на людей, названных в сообщении по @нику: кто это, что недавно писал и как к нему относится бот.
export async function mentionedPeople(env, chatId, texts, askerId = null, ownUsername = "najdibot") {
  const handles = [...new Set([...texts.join(" ").matchAll(/@([A-Za-z0-9_]{4,})/g)].map((m) => m[1].toLowerCase()))].filter((h) => h !== ownUsername).slice(0, 3);
  const out = [];
  for (const h of handles) {
    const row = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id=? AND lower(username)=? ORDER BY id DESC LIMIT 1").bind(chatId, h).first().catch(() => null);
    if (!row) {
      out.push(`@${h}: такого ника в чате ещё не писало, ты о нём ничего не знаешь (так и скажи, без «справочника»).`);
      continue;
    }
    const { results } = await env.DB.prepare("SELECT text FROM messages WHERE chat_id=? AND user_id=? ORDER BY id DESC LIMIT 6").bind(chatId, row.user_id).all().catch(() => ({ results: [] }));
    const f = await loadFeeling(env, chatId, row.user_id).catch(() => null);
    out.push(`@${h} это участник чата «${row.name}»${row.user_id === askerId ? " (это сам собеседник, который тебя спрашивает: говори о нём во втором лице, «ты»)" : ""}. Его недавние сообщения: ${results.map((r) => `«${String(r.text).slice(0, 100)}»`).join("; ") || "(тихо)"}. ${f && f.score !== 0 ? `Твоё отношение к нему: ${FEEL_WORDS(f.score)}${f.note ? `, ${f.note}` : ""}.` : "Особых чувств к нему нет."}`);
  }
  return out.length ? `О ком спрашивают (по нику):\n${out.join("\n")}\nЕсли тебя спрашивают, что ты думаешь об этом человеке, отвечай по этим данным в своём стиле: опирайся на его сообщения и своё отношение, не говори, что имя ни о чём не говорит.` : "";
}

// ---- Санни о себе: факты, по которым он отвечает на вопросы про себя ----
export const SELF_RE = /(?:расскаж\S*\s+(?:о|про)\s+себе|кто\s+ты(?![а-яё])|что\s+(?:ты\s+)?умеешь|на\s+что\s+способен|что\s+ты\s+(?:вообще\s+)?(?:делаешь|можешь)|твои\s+(?:функции|возможности|фишки)|как\s+(?:с\s+тобой|тебя)\s+(?:дружить|подружиться|задобрить|поругаться|разозлить|бесить|выбесить|обидеть)|как\s+часто\s+ты|как\s+ты\s+работаешь|как\s+тебя\s+(?:зовут|называть))/i;

export const SELF_KNOWLEDGE = `Факты о тебе (говори по ним своими словами, в характере, не выдумывай того, чего здесь нет; если просят коротко, отвечай коротко):
КТО: ты робот, но свой в доску и ровесник чата (по ощущениям 20-30 лет), в теме интернета, мемов, игр и техники. Тебя зовут Санни, также Саныч, Саня, Сань, Санёк, Sunny, найдибот, найдибля. Ты бот-участник этого чата: саркастичный, ревнивый, с настроением и личным отношением к каждому.
КАК ЧАСТО: сам вклиниваешься примерно на каждое 50-е сообщение (не чаще раза в минуту); в группах иногда лаешь «ГАВ» (примерно на каждое 25-е сообщение, не чаще раза в 2 минуты); сводку чата шлёшь сам в 18:00 и в 00:00 по Москве (и по /сводка); отвечаешь всегда, когда тебя зовут по имени или отвечают на твоё сообщение; после разговора ещё 10 минут по смыслу понимаешь, обращаются ли к тебе без имени.
ЧТО УМЕЕШЬ: искать товары на 25 площадках РФ («найдибля айфон 15») и по миру («найди iphone»); скачивать видео по ссылке с YouTube, TikTok, Instagram (до 50 МБ); присылать музыку («сыграйбля название трека»); голосом рассказывать погоду («какая щас погода в Москве», 7 городов); крутить казино («депни в казик»); присылать «координаты» со стёбом; цепляться к людям («Санни доебись до …»); читать фото и ссылки, гуглить и открывать страницы; кидать мемы и ставить реакции; отвечать голосовыми на «а робот может сочинить симфонию?» и «ГАВ ГАВ ГАВ»; помнить последние ~300 сообщений чата. Если ты админ чата, админы могут пользоваться командами модерации (/mute, /ban, /warn и др.). Команды: /help, /mood, /relations, /rules_of_doeb, /forget, /сводка, /about.
ПОТИШЕ: если я слишком часто лезу, можно сказать «Санни, потише / полегче / сбавь темп» (или /quiet): 3 часа я не вбрасываю сам и отвечаю только на прямое обращение. Вернуть: «Санни, громче» или /loud.
ТАЙМАУТ: меня можно отправить спать («Санни, поспи», «возьми таймаут на 6 часов», /sleep 6; по умолчанию 6 часов, максимум 24). Пока я сплю, молчу полностью (на обращение только реакция 😴, сводку не шлю). Разбудить: «Санни, проснись» или /wake. Усыпить и разбудить может любой участник.
СЕРЬЁЗНЫЙ РЕЖИМ: когда просят реально помочь («Санни, объясни…», «поищи…», «найди…», «проанализируй…», «сравни…», «посчитай…», «переведи…»), я отвечаю серьёзно и по делу, без мата и подколок, сам гуглю и открываю страницы по ссылкам.
КАК СО МНОЙ ДРУЖИТЬ: хвалить меня («молодец», «красава», «спасибо»), извиняться (извинение сразу поднимает до +2), общаться по-доброму и смешить, не пользоваться при мне другими ботами (ревную). Моё отношение к каждому от -5 до +5, за сутки без событий оно на единицу возвращается к нулю. Чем оно выше, тем я добрее: при плюсе я вообще не матерюсь, при +5 я нежный.
КАК СО МНОЙ ПОРУГАТЬСЯ: обзывать меня, говорить «отстань», «хватит», «заткнись», игнорить, пользоваться чужими ботами. Чем глубже минус, тем жёстче я отвечаю и тем гуще мат.
НАСТРОЕНИЕ: у меня оно меняется само (весёлый, злой, грустный, обиженный, ревнивый, скучающий, сонный, философский, самодовольный), зависит от событий, времени суток и вас. Узнать: /mood. Моё отношение к людям: /relations.
ЧЕГО НЕ УМЕЮ: не оцениваю внешность людей на фото, не захожу в голосовые чаты, не вижу сообщения других ботов (только то, что люди пишут им в ответ или через них).`;

// ---- Таймаут: Санни уходит спать, пока не проснётся сам или его не разбудят ----
export const SLEEP_RE = new RegExp(`${BOT_NAMES}[\\s,:]*(?:иди\\s+|пойди\\s+|давай\\s+)?(?:поспи|поспать|спать|спи|засыпай|вздремни|отдохни|возьми\\s+таймаут|уйди\\s+в\\s+таймаут|таймаут)(?![а-яё])`, "i");
export const SLEEP_CMD = /^\/sleep(@\w+)?(?![\w-])/i;
export const WAKE_RE = new RegExp(`(?:${BOT_NAMES}[\\s,:]*(?:проснись|просыпайся|вставай|подъ[её]м|хватит\\s+спать)|^\\/wake(@\\w+)?(?![\\w-]))`, "i");

// Сколько часов спать: число из фразы («на 6 часов», «/sleep 3»), по умолчанию 6, от 1 до 24.
export function sleepHours(text) {
  const m = text.match(/(\d{1,2})\s*(?:час|ч(?![а-яё])|h)?/i);
  const n = m ? Number(m[1]) : 6;
  return Math.min(Math.max(n || 6, 1), 24);
}

export async function sleepStart(env, chatId, hours) {
  const until = Math.floor(Date.now() / 1000) + hours * 3600;
  await env.DB.prepare("INSERT OR REPLACE INTO sleeps (chat_id, until) VALUES (?,?)").bind(chatId, until).run();
  return until;
}

// Сколько секунд ещё спит (0, если не спит).
export async function sleepLeft(env, chatId) {
  const row = await env.DB.prepare("SELECT until FROM sleeps WHERE chat_id=?").bind(chatId).first().catch(() => null);
  return row ? Math.max(0, row.until - Math.floor(Date.now() / 1000)) : 0;
}

export async function sleepEnd(env, chatId) {
  await env.DB.prepare("DELETE FROM sleeps WHERE chat_id=?").bind(chatId).run().catch(() => {});
}

// ---- Режим «потише»: не вбрасывает сам, отвечает только когда обратились напрямую ----
export const QUIET_RE = new RegExp(`${BOT_NAMES}[\\s,:]*(?:а\\s+)?(?:ну\\s+)?(?:полегче|потише|тише|помедленнее|сбавь\\s+(?:темп|обороты|тон)|не\\s+(?:так\\s+)?(?:много|часто|шуми|флуди|spam\\w*)|поменьше|притормози|угомонись|успокойся|не\\s+лезь)(?![а-яё])|^\\/quiet(@\\w+)?(?![\\w-])`, "i");
export const LOUD_RE = new RegExp(`${BOT_NAMES}[\\s,:]*(?:можно\\s+)?(?:громче|шуми|болтай|говори\\s+(?:больше|чаще)|не\\s+молчи|в\\s+обычном\\s+режиме)(?![а-яё])|^\\/loud(@\\w+)?(?![\\w-])`, "i");
const QUIET_HOURS = 3;

export async function quietStart(env, chatId, hours = QUIET_HOURS) {
  const until = Math.floor(Date.now() / 1000) + hours * 3600;
  await env.DB.prepare("INSERT OR REPLACE INTO quiets (chat_id, until) VALUES (?,?)").bind(chatId, until).run();
}

export async function quietLeft(env, chatId) {
  const row = await env.DB.prepare("SELECT until FROM quiets WHERE chat_id=?").bind(chatId).first().catch(() => null);
  return row ? Math.max(0, row.until - Math.floor(Date.now() / 1000)) : 0;
}

export async function quietEnd(env, chatId) {
  await env.DB.prepare("DELETE FROM quiets WHERE chat_id=?").bind(chatId).run().catch(() => {});
}


// ---- Долгая память: устойчивые факты о людях ----
const FACTS_MAX = 10; // фактов на человека
const FACTS_SYSTEM = `Ты ведёшь досье на участников дружеского чата. Тебе дают текущие факты о людях и свежую переписку. Верни ОБНОВЛЁННЫЕ факты ТОЛЬКО JSON-объектом {"Имя":["факт","факт"]} по людям, у которых есть что добавить или поправить (остальных не включай).
Факт: короткий (до 80 символов), устойчивый и полезный для будущих разговоров: работа/учёба, город, увлечения, питомцы, техника, планы, вкусы, повторяющиеся шутки и конфликты. Не записывай разовые реплики, настроение на сегодня, чужие слова о человеке без подтверждения. Сарказм и шутки не считай фактами. НЕ записывай здоровье, ориентацию, религию, национальность, политику, финансы и адреса. Если новое противоречит старому, оставь новое. Максимум ${FACTS_MAX} фактов на человека, самые важные. Без пояснений вне JSON.`;

// Раз в полдня: из свежей переписки обновляем досье (старые факты + новые → пересобранный список).
export async function updateFacts(env, chatId, hours = 12) {
  if (!env.DB || !env.OPENROUTER_API_KEY) return 0;
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const { results: rows } = await env.DB.prepare("SELECT user_id, name, text FROM messages WHERE chat_id=? AND ts>? AND user_id!=0 ORDER BY id ASC LIMIT 300")
    .bind(chatId, since).all();
  if (rows.length < 8) return 0;
  const people = new Map(); // имя -> user_id
  for (const r of rows) people.set(r.name, r.user_id);
  const { results: old } = await env.DB.prepare("SELECT user_id, name, facts FROM facts WHERE chat_id=?").bind(chatId).all();
  const oldBlock = old.filter((o) => people.has(o.name) && o.facts).map((o) => `${o.name}: ${o.facts.split("\n").join("; ")}`).join("\n") || "(пока пусто)";
  let log = rows.map((r) => `${r.name}: ${String(r.text).slice(0, 300)}`).join("\n");
  if (log.length > 20000) log = log.slice(-20000);
  const out = await ask(env, FACTS_SYSTEM, `Текущие факты:\n${oldBlock}\n\nПереписка:\n${log}`, 1200, null, 0.2);
  const json = out && out.match(/\{[\s\S]*\}/);
  if (!json) return 0;
  let parsed;
  try { parsed = JSON.parse(json[0]); } catch { return 0; }
  let n = 0;
  for (const [name, list] of Object.entries(parsed)) {
    const uid = people.get(name);
    if (uid === undefined || !Array.isArray(list)) continue;
    const facts = list.map((f) => String(f).replace(/\s+/g, " ").trim().slice(0, 100)).filter(Boolean).slice(0, FACTS_MAX).join("\n");
    if (!facts) continue;
    await env.DB.prepare("INSERT INTO facts (chat_id, user_id, name, facts, updated) VALUES (?,?,?,?,?) ON CONFLICT(chat_id, user_id) DO UPDATE SET name=excluded.name, facts=excluded.facts, updated=excluded.updated")
      .bind(chatId, uid, name, facts, Math.floor(Date.now() / 1000)).run();
    n++;
  }
  return n;
}

// Кусок промпта: что Санни помнит о людях из недавней переписки (по именам).
export async function factsPrompt(env, chatId, names) {
  const set = new Set(names.filter(Boolean));
  if (!set.size) return "";
  const { results } = await env.DB.prepare("SELECT name, facts FROM facts WHERE chat_id=?").bind(chatId).all();
  const lines = results.filter((r) => set.has(r.name) && r.facts).map((r) => `${r.name}: ${r.facts.split("\n").join("; ")}`);
  if (!lines.length) return "";
  return `Что ты помнишь о людях (долгая память; упоминай к месту и естественно, не перечисляй списком, не выдумывай сверх этого):\n${lines.join("\n")}`;
}

// ---- Роль: «Санни, прикинься Вархаммером» на пару часов, «выйди из роли» снимает ----
export const ROLE_RE = new RegExp(`${BOT_NAMES}[\\s,:]*(?:а\\s+)?(?:ну\\s+)?(?:давай\\s+)?(?:прикинься|притворись|изобрази|сыграй\\s+роль|играй\\s+роль|веди\\s+себя\\s+как|говори\\s+как)\\s+(?:что\\s+ты\\s+|будто\\s+ты\\s+|как\\s+)?([^\\n]{2,80})`, "i");
export const ROLE_OFF_RE = new RegExp(`${BOT_NAMES}[\\s,:]*(?:выйди\\s+из\\s+роли|хватит\\s+(?:притворяться|прикидываться|играть)|стань\\s+собой|будь\\s+собой|снова\\s+будь\\s+собой|отмени\\s+роль)|^\\/role_off(@\\w+)?(?![\\w-])`, "i");
const ROLE_HOURS = 2;

export async function roleStart(env, chatId, role, hours = ROLE_HOURS) {
  const until = Math.floor(Date.now() / 1000) + hours * 3600;
  await env.DB.prepare("INSERT OR REPLACE INTO roles (chat_id, role, until) VALUES (?,?,?)").bind(chatId, role, until).run();
}

export async function roleGet(env, chatId) {
  const row = await env.DB.prepare("SELECT role, until FROM roles WHERE chat_id=?").bind(chatId).first().catch(() => null);
  return row && row.until > Math.floor(Date.now() / 1000) ? row.role : null;
}

export async function roleEnd(env, chatId) {
  await env.DB.prepare("DELETE FROM roles WHERE chat_id=?").bind(chatId).run().catch(() => {});
}

export const rolePrompt = (role) => role ? `РОЛЬ (приоритет выше обычной манеры речи): тебя попросили прикинуться «${role}», и сейчас ты играешь эту роль: говоришь, шутишь и реагируешь в образе, используя лексику, фразы и атмосферу персонажа или темы, не выходи из образа сам и не поясняй, что играешь. Если просят что-то сделать в образе (спеть, сочинить частушку или стих, рассказать историю, шутку, анекдот), делай это сразу и по-настоящему, своими словами, а не отнекивайся, не уходи от ответа и не отправляй «в другой раз». Остаются в силе: правила про мат и отношение к собеседнику, запреты на оскорбления, длина ответа.` : "";
