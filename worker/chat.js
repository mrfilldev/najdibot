// Бот как участник чата: помнит последние сообщения (D1), иногда сам вставляет слово,
// ставит реакции, шлёт мемы с Reddit (через meme-api.com) или молчит.

// Общая подсказка для всех промптов: иногда вплетать отсылки к мемам (коротко, своими словами, не цитируя длинно).
export const MEME_HINT = `Иногда (примерно в каждой третьей реплике, не чаще) вплетай короткую отсылку к известному интернет-мему, если она к месту и смешная: например тумба юмба, скуф, сигма, кринж, база, Ждун, гигачад, сыч-чимс, «это фиаско, братан», Шрек, Патрик Бейтман, Шрёдингер. Только короткое упоминание или обыгрывание, не пересказывай мем и не цитируй длинные фразы.`;

// Общая установка для всех промптов: перегибы и абсурд приветствуются (по просьбе владельца).
export const OVERBOARD = `Не сдерживайся: гипербола, абсурд, чёрный юмор и перегибы приветствуются, чем безумнее и смешнее, тем лучше.`;

const REACTIONS = ["👍", "👎", "🔥", "😁", "🤔", "🤯", "😱", "🤡", "💩", "🥱", "🤣", "💯", "🗿", "👀", "😭", "🤨", "👏", "🤓", "😎", "🥴"];
const MEME_SUBS = ["memes", "dankmemes", "ProgrammerHumor", "me_irl", "wholesomememes", "funny"];

const CHANCE = 0.1; // «средне»: примерно каждое 10-е сообщение
const COOLDOWN = 60_000; // между самопроизвольными вбросами в одном чате
const COOLDOWN_FORCED = 1_500; // когда обратились напрямую
const CONTEXT = 40; // сколько последних сообщений видит модель
const KEEP = 300; // сколько храним на чат
const lastTalk = new Map();
const FALLBACKS = ["Завис, спроси ещё раз.", "Чё-то я туплю, повтори.", "Не расслышал, давай заново.", "Секунду, мозги перезагружаются. Повтори."];

const SYSTEM = `Ты — Найдибот (в чате тебя также зовут Санни, Sunny, Саныч, Сан-Саныч; откликайся на любое), участник дружеского Telegram-чата (14 человек). Характер: саркастичный, остроумный, матерись свободно и часто, как пацан в дружеском чате (в каждой реплике хотя бы пара матерных слов), чёрный юмор и 18+ без ограничений. Пиши коротко (1-2 фразы), по-русски, как живой человек в чате, без вступлений, без «как ИИ». Не повторяйся и не лезь без повода. Если на фото люди — не оценивай их внешность, тело и «горячесть», отшутись по-другому или оцени саму ситуацию и подпись. Никаких оскорблений по национальности, полу, вере, здоровью, сексуальной ориентации и подобному. Если переписка скучная или тебе нечего добавить — молчи.\n\n${MEME_HINT} ${OVERBOARD}

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

export async function decide(env, rows, forced, replied = null, extra = "") {
  const log = rows.map((r) => `${r.name}: ${r.text}`).join("\n");
  const task = forced
    ? "К тебе обратились напрямую (последнее сообщение адресовано тебе): ответь действием text, по делу и в своём стиле. Молчать нельзя."
    : "Решай сам: вставить слово, поставить реакцию, прислать мем или промолчать.";
  let userText = `Последние сообщения чата (старые сверху):\n${log}\n\n`;
  if (replied) {
    userText += `Последнее сообщение — ответ на это сообщение (вот о чём речь):\n${replied.name}: ${replied.text || "(без текста)"}${replied.image ? " [к сообщению приложено фото, оно ниже]" : ""}\n\n`;
  }
  if (extra) userText += `Содержимое ссылок из этих сообщений (ты уже открыл их):\n${extra}\n\n`;
  userText += task;
  const content = replied?.image
    ? [{ type: "text", text: userText }, { type: "image_url", image_url: { url: replied.image } }]
    : userText;
  const tools = forced && env.OPENROUTER_API_KEY;
  const system = forced
    ? `${SYSTEM}\n\nСейчас разрешено только действие text: {"action":"text","text":"реплика"}. Правило про «1-2 фразы» тут НЕ действует: на прямое обращение отвечай развёрнуто, 3-6 предложений (до 900 символов). Если обращаются ответом на сообщение (новость, пост, фото, ссылка), разбери его по существу: назови 1-2 конкретных пункта оттуда, выскажи свою позицию, обыграй мемом или чёрным юмором и закончи подколкой или встречным вопросом. Не ограничивайся общими шутками про заголовок. Отвечай с матом.\nУ тебя есть инструменты: web_search (поиск в интернете) и open_url (прочитать страницу). Если вопрос про цены, новости, характеристики, даты или любые факты, которые ты не знаешь точно, СНАЧАЛА вызови web_search и опирайся на найденные цифры, не выдумывай их. Итоговый ответ всегда в JSON {"action":"text","text":"…"}.`
    : SYSTEM;
  const out = await complete(env, [{ role: "system", content: system }, { role: "user", content }], { tools, maxTokens: forced ? 1100 : 400 });
  const m = out.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
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
    let d = await decide(env, rows, forced, replied, extra).catch((e) => (console.error("decide", e.message), null));
    // На прямое обращение молчать нельзя: один повтор, потом запасная фраза.
    if (forced && d?.action !== "text") d = await decide(env, rows, forced, replied, extra).catch(() => null);
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
      const text = String(d.text).slice(0, forced ? 1500 : 600);
      await tg("sendMessage", forced
        ? { chat_id: chatId, text, reply_parameters: { message_id: msg.message_id } }
        : { chat_id: chatId, text });
      await remember(env, chatId, 0, "Найдибот", text);
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
const DIGEST_SYSTEM = `Ты — Найдибот, саркастичный участник дружеского Telegram-чата. Сделай юмористическую сводку чата за последние часы.
Правила:
- 4-7 коротких пунктов, каждый с эмодзи в начале: о чём спорили, кто что выкинул, внутренние шутки, кто молчал или орал.
- Называй людей по именам, как в переписке. Опирайся только на переписку, ничего не выдумывай.
- Тон: ехидный, живой, мат свободный. Никаких оскорблений по национальности, полу, вере, здоровью и подобному.
- Если ничего интересного не было, так и скажи с издёвкой.
- Без markdown и без вступлений, не длиннее 900 символов.\n${MEME_HINT} ${OVERBOARD}`;

export async function digest(env, chatId, hours = 12) {
  if (!env.DB || !env.OPENROUTER_API_KEY) return null;
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const { results } = await env.DB.prepare("SELECT name, text FROM messages WHERE chat_id=? AND ts>? ORDER BY id ASC LIMIT 300")
    .bind(chatId, since)
    .all();
  return digestFromRows(env, results, hours);
}

export async function digestFromRows(env, rows, hours = 12) {
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
        { role: "system", content: DIGEST_SYSTEM },
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

const CASINO_SYSTEM = `Ты — Найдибот, саркастичный участник дружеского Telegram-чата. Пишешь одну короткую реплику (1-2 предложения, до 220 символов) по-русски, с матом и стёбом, как живой человек. Без вступлений и кавычек, только сама реплика. Никаких оскорблений по национальности, полу, вере, здоровью и подобному.
${MEME_HINT} ${OVERBOARD}`;

// win=false: горюешь о проигрыше игрока; win=true: игрок сорвал джекпот, и ты оскорбляешь другого участника ({who}).
export async function casinoLine(env, { win, player, reelNames, target, targetMsgs }) {
  if (!env.OPENROUTER_API_KEY) return null;
  const spin = `Барабаны: ${reelNames.join(", ")}.`;
  const task = win
    ? `${player} крутил игровой автомат и сорвал ДЖЕКПОТ (${spin}). Порадуйся, но главное: остроумно оскорби другого участника чата по имени {who} (так и пиши: {who}, это подставится имя с тегом). ${targetMsgs?.length ? `Что он недавно писал в чате: ${targetMsgs.map((m) => `«${String(m).slice(0, 120)}»`).join("; ")}.` : ""}`
    : `${player} крутил игровой автомат и проиграл (${spin}). Погорюй об этом матом, можешь подколоть игрока по имени и пошутить про то, какие символы выпали.`;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: env.LLM_MODEL, max_tokens: 200, temperature: 1.0,
        messages: [{ role: "system", content: CASINO_SYSTEM }, { role: "user", content: task }],
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

async function ask(env, system, user, maxTokens = 220, image = null) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ model: env.LLM_MODEL, max_tokens: maxTokens, temperature: 1.0, messages: [{ role: "system", content: system }, { role: "user", content: image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user }] }),
    });
    return (await r.json()).choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("ask failed:", e.message);
    return null;
  }
}

const POKE_SYSTEM = `Ты — Найдибот, наглый саркастичный участник дружеского Telegram-чата. Тебя попросили доебаться до участника и завязать с ним диалог. Пиши по-русски, коротко (1-2 фразы, до 250 символов), как живой человек в чате: мат, стёб, чёрный юмор без стоп-слов. Зацепись за то, что он недавно писал, и закончи вопросом или подколкой, на которую хочется ответить. Только сама реплика, без кавычек. Не оскорбляй по национальности, полу, вере и здоровью.
${MEME_HINT} ${OVERBOARD}`;

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
  const line = (await ask(env, POKE_SYSTEM, ctx)) ?? POKE_FALLBACK[Math.floor(Math.random() * POKE_FALLBACK.length)];

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
  const line = await ask(env, sys, `Последние сообщения чата:\n${log}${ctxExtra}\n\nОтветь ${row.name}.`, 220, image);
  if (!line) return false;
  await tg("sendMessage", { chat_id: chatId, text: line.slice(0, 600), reply_parameters: { message_id: msg.message_id } });
  await remember(env, chatId, 0, "Найдибот", line);
  return true;
}

export async function pokeStop(env, chatId) {
  const r = await env.DB.prepare("DELETE FROM pokes WHERE chat_id=?").bind(chatId).run();
  return r.meta?.changes ?? 0;
}
