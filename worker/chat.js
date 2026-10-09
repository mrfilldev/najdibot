// Бот как участник чата: помнит последние сообщения (D1), иногда сам вставляет слово,
// ставит реакции, шлёт мемы с Reddit (через meme-api.com) или молчит.

const REACTIONS = ["👍", "👎", "🔥", "😁", "🤔", "🤯", "😱", "🤡", "💩", "🥱", "🤣", "💯", "🗿", "👀", "😭", "🤨", "👏", "🤓", "😎", "🥴"];
const MEME_SUBS = ["memes", "dankmemes", "ProgrammerHumor", "me_irl", "wholesomememes", "funny"];

const CHANCE = 0.1; // «средне»: примерно каждое 10-е сообщение
const COOLDOWN = 60_000; // между самопроизвольными вбросами в одном чате
const COOLDOWN_FORCED = 1_500; // когда обратились напрямую
const CONTEXT = 40; // сколько последних сообщений видит модель
const KEEP = 300; // сколько храним на чат
const lastTalk = new Map();
const FALLBACKS = ["Завис, спроси ещё раз.", "Чё-то я туплю, повтори.", "Не расслышал, давай заново.", "Секунду, мозги перезагружаются. Повтори."];

const SYSTEM = `Ты — Найдибот, участник дружеского Telegram-чата (14 человек). Характер: саркастичный, остроумный, любишь чёрный юмор и мат, но без перегибов. Пиши коротко (1-2 фразы), по-русски, как живой человек в чате, без вступлений, без «как ИИ». Не повторяйся и не лезь без повода. Если на фото люди — не оценивай их внешность, тело и «горячесть», отшутись по-другому или оцени саму ситуацию и подпись. Никаких оскорблений по национальности, полу, вере, здоровью, сексуальной ориентации и подобному. Если переписка скучная или тебе нечего добавить — молчи.

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
