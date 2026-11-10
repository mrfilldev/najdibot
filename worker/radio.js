// Радио по треку: «сыграйбля радио <трек>» → до RADIO_AHEAD треков подряд в чат (плеер Telegram сам играет их без пауз),
// кнопки ♡ / ♡̸ / ⏭ / ■ корректируют поток. Состояние живёт в D1 (контейнер засыпает), контейнер качает и шлёт (/radio)
// и после каждого трека отчитывается (/log-radio).
import { dl } from "./remote.js";

// Запрос необязателен: «сыграйбля радио» без трека строит радио от недавних ♡ (group 1 тогда undefined).
export const RADIO_RE = /^(?:сыграйбля|диджейбля)[\s,:;!.-]+радио(?:[\s,:;!.-]+(.{2,}))?[\s,:;!.-]*$/is;
export const RADIO_AHEAD = 10; // сколько треков держим в чате вперёд

const parse = (s, d) => {
  try {
    return JSON.parse(s ?? "");
  } catch {
    return d;
  }
};

export const radioKeyboard = (id, mark = "") => ({
  inline_keyboard: [
    [
      { text: mark === "u" ? "♥" : "♡", callback_data: `rd:u:${id}` },
      { text: mark === "d" ? "♡̸ ✓" : "♡̸", callback_data: `rd:d:${id}` },
      { text: "⏭︎", callback_data: `rd:n:${id}` },
      { text: "■", callback_data: `rd:s:${id}` },
    ],
  ],
});

// Имя для списка «не хочу»: без " - Topic" и регистра
export const badKey = (s) => String(s || "").replace(/\s*-\s*topic$/i, "").trim().toLowerCase();

export async function getSession(env, chatId) {
  const r = await env.DB.prepare("SELECT * FROM radio_session WHERE chat_id = ?").bind(chatId).first();
  return r && { ...r, queue: parse(r.queue, []), played: parse(r.played, []), bad: parse(r.bad, []), cur: parse(r.cur, null), sent: parse(r.sent, []) };
}

const save = (env, s) =>
  env.DB.prepare("UPDATE radio_session SET queue = ?, played = ?, bad = ?, cur = ?, reseed = ?, sent = ?, gen = ?, updated = ? WHERE chat_id = ?")
    .bind(JSON.stringify(s.queue.slice(0, 60)), JSON.stringify(s.played.slice(-300)), JSON.stringify(s.bad), JSON.stringify(s.cur), s.reseed ?? null, JSON.stringify(s.sent.slice(-40)), s.gen, Math.floor(Date.now() / 1000), s.chat_id)
    .run();

// Просит контейнер прислать ещё `count` треков (новое поколение прерывает прогон, который ещё идёт).
const fill = (env, s, count) =>
  dl(env, "/radio", { method: "POST", body: JSON.stringify({ chat_id: s.chat_id, count, gen: s.gen, queue: s.queue, played: s.played, bad: s.bad, reseed: s.reseed ?? null }) });

// Затравка без запроса: случайный из последних 20 ♡ пользователя (кроме треков, которые он потом забраковал).
async function likedSeed(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT video_id FROM track_feedback WHERE user_id = ? AND rating = 1 " +
      "AND video_id NOT IN (SELECT video_id FROM track_feedback WHERE user_id = ? AND rating = -1) ORDER BY ts DESC LIMIT 20",
  ).bind(userId, userId).all();
  return results.length ? results[Math.floor(Math.random() * results.length)].video_id : null;
}

// Новая сессия (старая сбрасывается): контейнер найдёт затравку и пришлёт её и ещё RADIO_AHEAD-1 треков.
// Без `query` затравка берётся из ♡ пользователя `userId`; если их нет — возвращает {empty:true}, сессию не трогает.
export async function radioStart(env, chatId, messageId, query, userId) {
  const liked = query ? null : await likedSeed(env, userId);
  if (!query && !liked) return { empty: true };
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO radio_session (chat_id, gen, updated) VALUES (?, 1, ?) " +
      "ON CONFLICT(chat_id) DO UPDATE SET queue='[]', played='[]', bad='[]', cur=NULL, reseed=NULL, sent='[]', gen=gen+1, updated=excluded.updated",
  ).bind(chatId, now).run();
  const s = await getSession(env, chatId);
  await dl(env, "/radio", { method: "POST", body: JSON.stringify({ chat_id: chatId, message_id: messageId, query: query ?? null, count: RADIO_AHEAD, gen: s.gen, queue: [], played: liked ? [liked] : [], bad: [], reseed: liked }) });
  return { empty: false };
}

// Отчёт контейнера: отправлен трек `track` (сообщение `mid`), в очереди осталось `queue`.
// Ответ {abort:true} — прогон устарел (нажали кнопку или сессию выключили): контейнер удаляет трек и останавливается.
export async function radioReport(env, r) {
  const s = await getSession(env, r.chat_id);
  if (!s || s.gen !== r.gen) return { abort: true };
  if (!r.track) return { abort: false };
  s.queue = r.queue ?? [];
  s.played = [...s.played, r.track.id];
  s.cur = r.track;
  s.reseed = null;
  s.sent = [...s.sent, { mid: r.mid, id: r.track.id, title: r.track.title, performer: r.track.performer }];
  await save(env, s);
  return { abort: false };
}

// Нажатие кнопки. `del(mids)` удаляет сообщения. Возвращает {answer, mark?, stop?}.
export async function radioPress(env, cq, del = async () => {}) {
  const [, act, id] = String(cq.data).split(":");
  const chatId = cq.message?.chat?.id;
  const s = chatId && (await getSession(env, chatId));
  if (!s) return { answer: "Радио уже выключено. Напиши «сыграйбля радио <трек>»" };
  const mid = cq.message.message_id;
  const later = s.sent.filter((e) => e.mid > mid); // присланные позже нажатого: ещё не слушали
  const dropLater = async () => {
    if (later.length) await del(later.map((e) => e.mid));
    s.sent = s.sent.filter((e) => e.mid <= mid);
    s.queue = s.queue.filter((e) => !later.some((l) => l.id === e.id));
  };
  if (act !== "d") s.gen += 1; // старый прогон контейнера на следующем отчёте прервётся (дизлайк поток не трогает)
  if (act === "s") {
    await dropLater();
    await env.DB.prepare("DELETE FROM radio_session WHERE chat_id = ?").bind(chatId).run();
    return { answer: "Радио выключено", stop: true };
  }
  const now = Math.floor(Date.now() / 1000);
  const cur = s.sent.find((e) => e.id === id) ?? (s.cur?.id === id ? s.cur : { id, title: null, performer: null });
  if (act === "u" || act === "d") {
    await env.DB.prepare("INSERT INTO track_feedback (ts, user_id, video_id, title, performer, rating) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(now, cq.from.id, id, cur.title, cur.performer, act === "u" ? 1 : -1).run();
  }
  if (act === "u") {
    // ♡: присланный вперёд хвост удаляем, дальше строим микс от этого трека
    await dropLater();
    s.reseed = id;
    await save(env, s);
    await fill(env, s, RADIO_AHEAD - 1);
    return { answer: "Запомнил, дальше подберу похожее", mark: "u" };
  }
  if (act === "d") {
    // ♡̸ — только про этот трек: в историю оценок, больше не играем; поток и присланные треки не трогаем
    s.queue = s.queue.filter((e) => e.id !== id);
    if (!s.played.includes(id)) s.played.push(id);
    await save(env, s);
    return { answer: "Этот трек больше не поставлю", mark: "d" };
  }
  // ⏭: резерв (плеер и так играет следующий) — просто докачиваем буфер до RADIO_AHEAD
  const need = RADIO_AHEAD - 1 - later.length;
  await save(env, s);
  if (need <= 0) return { answer: "Дальше уже в чате: жми следующий в плеере" };
  await fill(env, s, need);
  return { answer: "" };
}
