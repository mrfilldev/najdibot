// Настройки функций бота для группы: /settings с кнопками.
// Менять включённость функций могут админы; «кто меняет» (admins | all) переключают только админы.

export const FEATURES = [
  ["chat", "Болтовня и лай"],
  ["poke", "Доёбы"],
  ["casino", "Казино"],
  ["weather", "Погода"],
  ["music", "Музыка (сыграйбля/диджейбля)"],
  ["video", "Скачивание видео по ссылке"],
  ["discord", "Созыв (явдисе, дискорд)"],
  ["persona", "Роли и клички"],
  ["roast", "Подколки чужих ботов"],
  ["fun", "Симфония и гав-гав-гав"],
  ["mod", "Модерация (mute/ban/warn)"],
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
  rows.push([{ text: `Кто меняет: ${s.who === "all" ? "все" : "только админы"}`, callback_data: "st:who" }]);
  return {
    text: "Настройки функций в этом чате.\nНажми на кнопку, чтобы включить или выключить.",
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
