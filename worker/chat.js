// Бот как участник чата: помнит последние сообщения (D1), иногда сам вставляет слово,
// ставит реакции, шлёт мемы с Reddit (через meme-api.com) или молчит.

// Общая подсказка для всех промптов: иногда вплетать отсылки к мемам (коротко, своими словами, не цитируя длинно).
export const MEME_HINT = `Иногда (примерно в каждой третьей реплике, не чаще) вплетай короткую отсылку к известному интернет-мему, если она к месту и смешная: например тумба юмба, скуф, сигма, кринж, база, Ждун, гигачад, сыч-чимс, «это фиаско, братан», Шрек, Патрик Бейтман, Шрёдингер. Только короткое упоминание или обыгрывание, не пересказывай мем и не цитируй длинные фразы.`;

const REACTIONS = ["👍", "👎", "🔥", "😁", "🤔", "🤯", "😱", "🤡", "💩", "🥱", "🤣", "💯", "🗿", "👀", "😭", "🤨", "👏", "🤓", "😎", "🥴"];
const MEME_SUBS = ["memes", "dankmemes", "ProgrammerHumor", "me_irl", "wholesomememes", "funny"];

const CHANCE = 0.1; // «средне»: примерно каждое 10-е сообщение
const COOLDOWN = 60_000; // между самопроизвольными вбросами в одном чате
const COOLDOWN_FORCED = 1_500; // когда обратились напрямую
const CONTEXT = 40; // сколько последних сообщений видит модель
const KEEP = 300; // сколько храним на чат
const lastTalk = new Map();
const FALLBACKS = ["Завис, спроси ещё раз.", "Чё-то я туплю, повтори.", "Не расслышал, давай заново.", "Секунду, мозги перезагружаются. Повтори."];

const SYSTEM = `Ты — Найдибот, участник дружеского Telegram-чата (14 человек). Характер: саркастичный, остроумный, любишь чёрный юмор и мат, но без перегибов. Пиши коротко (1-2 фразы), по-русски, как живой человек в чате, без вступлений, без «как ИИ». Не повторяйся и не лезь без повода. Если на фото люди — не оценивай их внешность, тело и «горячесть», отшутись по-другому или оцени саму ситуацию и подпись. Никаких оскорблений по национальности, полу, вере, здоровью, сексуальной ориентации и подобному. Если переписка скучная или тебе нечего добавить — молчи.\n\n${MEME_HINT}

Ты можешь выбрать одно действие и ответить ТОЛЬКО JSON без пояснений:
{"action":"text","text":"реплика"} — написать сообщение;
{"action":"reaction","emoji":"одна эмодзи из списка"} — поставить реакцию на последнее сообщение (список: ${REACTIONS.join(" ")});
{"action":"meme","subreddit":"один из: ${MEME_SUBS.join(", ")}","text":"короткая подпись к мему, в тему беседы"} — прислать мем;
{"action":"skip"} — промолчать.`;




const pick = (a) => a[Math.floor(Math.random() * a.length)];

export async function remember(env, chatId, userId, name, text, messageId = null) {
  text = (text || "").trim();
  if (!text || !env.DB) return;
  await env.DB.prepare("INSERT INTO messages (chat_id, message_id, user_id, name, text, ts) VALUES (?,?,?,?,?,?)")
    .bind(chatId, messageId, userId, name, text.slice(0, 500), Math.floor(Date.now() / 1000))
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

export async function decide(env, rows, forced, replied = null) {
  const log = rows.map((r) => `${r.name}: ${r.text}`).join("\n");
  const task = forced
    ? "К тебе обратились напрямую (последнее сообщение адресовано тебе): ответь действием text, по делу и в своём стиле. Молчать нельзя."
    : "Решай сам: вставить слово, поставить реакцию, прислать мем или промолчать.";
  let userText = `Последние сообщения чата (старые сверху):\n${log}\n\n`;
  if (replied) {
    userText += `Последнее сообщение — ответ на это сообщение (вот о чём речь):\n${replied.name}: ${replied.text || "(без текста)"}${replied.image ? " [к сообщению приложено фото, оно ниже]" : ""}\n\n`;
  }
  userText += task;
  const content = replied?.image
    ? [{ type: "text", text: userText }, { type: "image_url", image_url: { url: replied.image } }]
    : userText;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model: env.LLM_MODEL,
      max_tokens: 400,
      messages: [
        { role: "system", content: forced ? `${SYSTEM}\n\nСейчас разрешено только действие text: {"action":"text","text":"реплика"}.` : SYSTEM },
        { role: "user", content },
      ],
    }),
  });
  const out = (await r.json()).choices?.[0]?.message?.content ?? "";
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
    const replied = rep && {
      name: rep.from?.first_name || rep.from?.username || "кто-то",
      text: (rep.text || rep.caption || "").slice(0, 500),
      image: rep.photo ? await photoDataUrl(env, rep.photo) : null,
    };
    const rows = await history(env, chatId);
    let d = await decide(env, rows, forced, replied).catch((e) => (console.error("decide", e.message), null));
    // На прямое обращение молчать нельзя: один повтор, потом запасная фраза.
    if (forced && d?.action !== "text") d = await decide(env, rows, forced, replied).catch(() => null);
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
      const text = String(d.text).slice(0, 600);
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
- Тон: ехидный, живой, можно лёгкий мат. Никаких оскорблений по национальности, полу, вере, здоровью и подобному.
- Если ничего интересного не было, так и скажи с издёвкой.
- Без markdown и без вступлений, не длиннее 900 символов.\n${MEME_HINT}`;

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
${MEME_HINT}`;

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
