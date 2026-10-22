// Настройки функций бота для группы: /settings с кнопками.
// Менять включённость функций могут админы; «кто меняет» (admins | all) переключают только админы.

export const FEATURES = [
  ["chat", "Болтовня"],
  ["poke", "Доёбы"],
  ["casino", "Казино"],
  ["weather", "Погода"],
  ["music", "Музыка"],
  ["video", "Скачивание"],
  ["discord", "Созыв"],
  ["persona", "Роли"],
  ["roast", "Подколки ботов"],
  ["fun", "Симфония"],
  ["mod", "Модерация"],
];

// Таблицу создаём на лету: у wrangler может не быть прав на D1 для миграций.
const ready = new WeakSet();
const ensure = async (env) => {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS chat_settings (chat_id INTEGER PRIMARY KEY, flags TEXT NOT NULL DEFAULT '{}', who TEXT NOT NULL DEFAULT 'admins')").run();
  ready.add(env.DB);
};

const caches = new WeakMap(); // по базе, чтобы изоляты и тесты не делили кэш
const cacheOf = (env) => caches.get(env.DB) ?? caches.set(env.DB, new Map()).get(env.DB);
const TTL = 20_000;

export async function getSettings(env, chatId) {
  const cache = cacheOf(env);
  const c = cache.get(chatId);
  if (c && Date.now() - c.at < TTL) return c.s;
  let s = { flags: {}, who: "admins" };
  try {
    await ensure(env);
    const row = await env.DB.prepare("SELECT flags, who FROM chat_settings WHERE chat_id = ?").bind(chatId).first();
    if (row) s = { flags: JSON.parse(row.flags || "{}"), who: row.who };
  } catch (e) {
    console.error("settings", e.message); // при сбое БД всё остаётся включённым
  }
  cache.set(chatId, { at: Date.now(), s });
  return s;
}

async function save(env, chatId, s) {
  await ensure(env);
  await env.DB.prepare("INSERT INTO chat_settings (chat_id, flags, who) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET flags = excluded.flags, who = excluded.who")
    .bind(chatId, JSON.stringify(s.flags), s.who).run();
  cacheOf(env).set(chatId, { at: Date.now(), s });
}

// Кого не звать в созыве (явдисе, дискорд): личная отписка и список от админов.
const ensureOptout = (env) => env.DB.prepare("CREATE TABLE IF NOT EXISTS call_optout (chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (chat_id, user_id))").run();

export async function optedOut(env, chatId) {
  try {
    await ensureOptout(env);
    const { results } = await env.DB.prepare("SELECT user_id FROM call_optout WHERE chat_id = ?").bind(chatId).all();
    return new Set(results.map((r) => r.user_id));
  } catch (e) {
    console.error("optout", e.message);
    return new Set();
  }
}

export async function setOptout(env, chatId, userId, out) {
  await ensureOptout(env);
  await env.DB.prepare(out ? "INSERT OR IGNORE INTO call_optout (chat_id, user_id) VALUES (?, ?)" : "DELETE FROM call_optout WHERE chat_id = ? AND user_id = ?")
    .bind(chatId, userId).run();
}

// «кроме Васи и Пети» -> { ids, missing }: имена и @username ищем среди тех, кого бот видел в чате (с запасом на падежи).
export async function resolveNames(env, chatId, list) {
  const { results } = await env.DB.prepare("SELECT user_id, name, username FROM messages WHERE chat_id = ? AND user_id > 0 GROUP BY user_id ORDER BY MAX(id) DESC LIMIT 200")
    .bind(chatId).all().catch(() => ({ results: [] }));
  const ids = [], missing = [];
  for (const raw of list.split(/\s*,\s*|\s+и\s+/i)) {
    const tok = raw.trim().replace(/^@/, "").toLowerCase();
    if (!tok) continue;
    const stem = tok.slice(0, Math.max(3, tok.length - 2));
    const hit = results.find((u) => (u.username || "").toLowerCase() === tok || (u.name || "").toLowerCase().startsWith(stem));
    if (hit) ids.push(hit.user_id); else missing.push(raw.trim());
  }
  return { ids, missing };
}

export const featureOn = (s, key) => s.flags[key] !== false;

function panel(s) {
  const rows = [];
  for (let i = 0; i < FEATURES.length; i += 2) {
    rows.push(FEATURES.slice(i, i + 2).map(([k, name]) => ({
      text: `${featureOn(s, k) ? "✅" : "❌"} ${name}`,
      callback_data: `st:${k}`,
    })));
  }
  rows.push([{ text: "👥 Кого звать в созыв", callback_data: "st:p:0" }]);
  rows.push([{ text: "🏷 Клички участников", callback_data: "st:n:0" }]);
  rows.push([{ text: `Кто меняет: ${s.who === "all" ? "все" : "только админы"}`, callback_data: "st:who" }]);
  return {
    text: [
      "Настройки функций в этом чате. Нажми на кнопку, чтобы включить или выключить.",
      "",
      "Болтовня: болтает и лает в ответ",
      "Доёбы: цепляется к людям",
      "Музыка: сыграйбля и диджейбля",
      "Скачивание: видео, фото и файлы по ссылке",
      "Созыв: зовёт в дискорд (явдисе)",
      "Роли: роли и клички",
      "Подколки ботов: подкалывает чужих ботов",
      "Симфония: симфония и гав-гав-гав",
      "Модерация: mute, ban, warn",
    ].join("\n"),
    reply_markup: { inline_keyboard: rows },
  };
}

const PAGE = 10;
async function peoplePanel(env, chatId, page) {
  const { results } = await env.DB.prepare("SELECT user_id, name FROM messages WHERE chat_id = ? AND user_id > 0 GROUP BY user_id ORDER BY MAX(id) DESC LIMIT 200")
    .bind(chatId).all().catch(() => ({ results: [] }));
  const out = await optedOut(env, chatId);
  const pages = Math.max(1, Math.ceil(results.length / PAGE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const slice = results.slice(page * PAGE, page * PAGE + PAGE);
  const rows = [];
  for (let i = 0; i < slice.length; i += 2) {
    rows.push(slice.slice(i, i + 2).map((u) => ({
      text: `${out.has(u.user_id) ? "❌" : "✅"} ${(u.name || "участник").slice(0, 20)}`,
      callback_data: `st:u:${u.user_id}:${page}`,
    })));
  }
  const nav = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: `st:p:${page - 1}` });
  nav.push({ text: `${page + 1}/${pages}`, callback_data: "st:back" });
  if (page < pages - 1) nav.push({ text: "▶️", callback_data: `st:p:${page + 1}` });
  rows.push(nav);
  rows.push([{ text: "← К настройкам", callback_data: "st:back" }]);
  return {
    text: results.length ? "Кого звать в созыв (явдисе, дискорд): ✅ звать, ❌ не звать." : "Я тут пока никого не видел.",
    reply_markup: { inline_keyboard: rows },
  };
}

// Клички: список людей с текущей кличкой; нажатие просит ответить сообщением с новой кличкой.
const NICK_MARK = "🏷 Кличка для #";
// Таблицу создаём на лету (как chat_settings): миграции у wrangler могут не пройти
const ensureNicks = (env) => env.DB.prepare("CREATE TABLE IF NOT EXISTS nicknames (chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, nick TEXT NOT NULL, PRIMARY KEY (chat_id, user_id))").run();
async function nickPanel(env, chatId, page) {
  await ensureNicks(env).catch(() => {});
  const { results } = await env.DB.prepare("SELECT m.user_id, m.name, n.nick FROM (SELECT user_id, name FROM messages WHERE chat_id = ? AND user_id > 0 GROUP BY user_id ORDER BY MAX(id) DESC LIMIT 200) m LEFT JOIN nicknames n ON n.chat_id = ? AND n.user_id = m.user_id")
    .bind(chatId, chatId).all().catch(() => ({ results: [] }));
  const pages = Math.max(1, Math.ceil(results.length / 8));
  page = Math.min(Math.max(page, 0), pages - 1);
  const rows = results.slice(page * 8, page * 8 + 8).map((u) => [{
    text: `${u.nick ? "🏷" : "▫️"} ${(u.name || "участник").slice(0, 16)}${u.nick ? ` — ${u.nick.slice(0, 14)}` : ""}`,
    callback_data: `st:nu:${u.user_id}:${page}`,
  }]);
  const nav = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: `st:n:${page - 1}` });
  nav.push({ text: `${page + 1}/${pages}`, callback_data: "st:back" });
  if (page < pages - 1) nav.push({ text: "▶️", callback_data: `st:n:${page + 1}` });
  rows.push(nav);
  rows.push([{ text: "← К настройкам", callback_data: "st:back" }]);
  return {
    text: results.length ? "Клички: нажми на человека и ответь на моё сообщение новой кличкой. 🏷 — кличка уже есть." : "Я тут пока никого не видел.",
    reply_markup: { inline_keyboard: rows },
  };
}

// Ответ на «🏷 Кличка для #id»: ставим или (при «-») убираем кличку. true, если сообщение обработано.
export async function nickReply(env, tg, msg) {
  const r = msg.reply_to_message;
  const m = r?.from?.is_bot && msg.text && String(r.text || "").startsWith(NICK_MARK) && r.text.match(/#(\d+)/);
  if (!m) return false;
  await ensureNicks(env).catch(() => {});
  const s = await getSettings(env, msg.chat.id);
  const say = (text) => tg("sendMessage", { chat_id: msg.chat.id, reply_parameters: { message_id: msg.message_id }, text });
  if (s.who !== "all" && !(await isAdmin(tg, msg.chat.id, msg.from.id))) {
    await say("Менять клички могут только админы.");
    return true;
  }
  const nick = msg.text.trim().replace(/^[«"]|[»"]$/g, "");
  if (/^[-–—]$/.test(nick)) {
    await env.DB.prepare("DELETE FROM nicknames WHERE chat_id = ? AND user_id = ?").bind(msg.chat.id, +m[1]).run();
    await say("Кличку убрал.");
  } else if (nick.length < 2 || nick.length > 30) {
    await say("Кличка должна быть от 2 до 30 символов. Нажми на человека в /settings и попробуй ещё раз.");
  } else {
    await env.DB.prepare("INSERT OR REPLACE INTO nicknames (chat_id, user_id, nick) VALUES (?,?,?)").bind(msg.chat.id, +m[1], nick).run();
    await say(`Принято, теперь он «${nick}».`);
  }
  return true;
}

const isAdmin = async (tg, chatId, userId) => {
  const r = await (await tg("getChatMember", { chat_id: chatId, user_id: userId })).json();
  return ["creator", "administrator"].includes(r.result?.status);
};

// /settings: показать панель.
export async function showSettings(env, tg, msg) {
  const p = panel(await getSettings(env, msg.chat.id));
  await tg("sendMessage", { chat_id: msg.chat.id, reply_parameters: { message_id: msg.message_id }, ...p });
}

// Нажатие кнопки панели.
export async function settingsCallback(env, tg, cq) {
  const m = cq.message;
  const key = cq.data?.slice(3);
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: !!text });
  if (!m || (m.chat.type !== "group" && m.chat.type !== "supergroup")) return answer();
  const chatId = m.chat.id;
  const s = await getSettings(env, chatId);
  const admin = await isAdmin(tg, chatId, cq.from.id);
  const edit = (p) => tg("editMessageText", { chat_id: chatId, message_id: m.message_id, ...p });
  if (key === "back") {
    await edit(panel(s));
    return answer();
  }
  if (key.startsWith("p:")) {
    await edit(await peoplePanel(env, chatId, +key.slice(2) || 0));
    return answer();
  }
  if (key.startsWith("n:")) {
    await edit(await nickPanel(env, chatId, +key.slice(2) || 0));
    return answer();
  }
  if (key.startsWith("nu:")) {
    if (!admin && s.who !== "all") return answer("Менять клички могут только админы.");
    const uid = +key.split(":")[1];
    const { results } = await env.DB.prepare("SELECT name FROM messages WHERE chat_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1").bind(chatId, uid).all().catch(() => ({ results: [] }));
    await tg("sendMessage", {
      chat_id: chatId,
      text: `${NICK_MARK}${uid} (${results[0]?.name || "участник"}): ответь на это сообщение кличкой (2–30 символов), «-» уберёт кличку.`,
      reply_markup: { force_reply: true, input_field_placeholder: "Кличка" },
    });
    return answer();
  }
  if (key.startsWith("u:")) {
    if (!admin && s.who !== "all") return answer("Менять настройки могут только админы.");
    const [, uid, page] = key.split(":");
    const out = await optedOut(env, chatId);
    await setOptout(env, chatId, +uid, !out.has(+uid));
    await edit(await peoplePanel(env, chatId, +page || 0));
    return answer();
  }
  if (key === "who") {
    if (!admin) return answer("Это могут менять только админы.");
    s.who = s.who === "all" ? "admins" : "all";
  } else if (FEATURES.some(([k]) => k === key)) {
    if (!admin && s.who !== "all") return answer("Менять настройки могут только админы.");
    s.flags[key] = !featureOn(s, key);
  } else {
    return answer();
  }
  await save(env, chatId, s);
  await tg("editMessageText", { chat_id: chatId, message_id: m.message_id, ...panel(s) });
  return answer();
}
