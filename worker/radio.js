// Радио по треку: «сыграйбля радио <трек>» → трек + кнопки 👍/👎/⏭, дальше поток из YouTube Mix.
// Состояние живёт в D1 (контейнер засыпает), контейнер только качает и шлёт трек (/radio) и отчитывается (/log-radio).
import { dl } from "./remote.js";

export const RADIO_RE = /^(?:сыграйбля|диджейбля)[\s,:;!.-]+радио[\s,:;!.-]+(.{2,})$/is;
export const RADIO_BUSY_SEC = 60;

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
      { text: mark === "u" ? "👍 ✓" : "👍", callback_data: `rd:u:${id}` },
      { text: mark === "d" ? "👎 ✓" : "👎", callback_data: `rd:d:${id}` },
      { text: "⏭ Дальше", callback_data: `rd:n:${id}` },
      { text: "⏹", callback_data: `rd:s:${id}` },
    ],
  ],
});

// Имя для списка «не хочу»: без " - Topic" и регистра
export const badKey = (s) => String(s || "").replace(/\s*-\s*topic$/i, "").trim().toLowerCase();

export async function getSession(env, chatId) {
  const r = await env.DB.prepare("SELECT * FROM radio_session WHERE chat_id = ?").bind(chatId).first();
  return r && { ...r, queue: parse(r.queue, []), played: parse(r.played, []), bad: parse(r.bad, []), cur: parse(r.cur, null) };
}

// Запускает новую сессию (сбрасывает старую) и просит контейнер сыграть первый трек.
export async function radioStart(env, chatId, messageId, query) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO radio_session (chat_id, queue, played, bad, cur, reseed, busy_until, updated) VALUES (?, '[]', '[]', '[]', NULL, NULL, ?, ?) " +
      "ON CONFLICT(chat_id) DO UPDATE SET queue='[]', played='[]', bad='[]', cur=NULL, reseed=NULL, busy_until=excluded.busy_until, updated=excluded.updated",
  ).bind(chatId, now + RADIO_BUSY_SEC, now).run();
  await dl(env, "/radio", { method: "POST", body: JSON.stringify({ chat_id: chatId, message_id: messageId, query, queue: [], played: [], bad: [], reseed: null }) });
}

// Просит следующий трек: контейнер получает очередь, сыгранное и «плохих» исполнителей.
export async function radioNext(env, s) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE radio_session SET busy_until = ?, updated = ? WHERE chat_id = ?").bind(now + RADIO_BUSY_SEC, now, s.chat_id).run();
  await dl(env, "/radio", { method: "POST", body: JSON.stringify({ chat_id: s.chat_id, queue: s.queue, played: s.played, bad: s.bad, reseed: s.reseed }) });
}

// Отчёт контейнера: сыгран трек `track`, в очереди осталось `queue`. track=null — не вышло, снимаем занятость.
export async function radioReport(env, r) {
  const now = Math.floor(Date.now() / 1000);
  if (!r.track) {
    await env.DB.prepare("UPDATE radio_session SET busy_until = 0, updated = ? WHERE chat_id = ?").bind(now, r.chat_id).run();
    return;
  }
  const s = await getSession(env, r.chat_id);
  const played = [...(s?.played ?? []), r.track.id].slice(-300);
  await env.DB.prepare("UPDATE radio_session SET queue = ?, played = ?, cur = ?, reseed = NULL, busy_until = 0, updated = ? WHERE chat_id = ?")
    .bind(JSON.stringify((r.queue ?? []).slice(0, 60)), JSON.stringify(played), JSON.stringify(r.track), now, r.chat_id).run();
}

// Нажатие кнопки. Возвращает {answer, mark?, stop?, next?}; побочные эффекты (D1) делает здесь.
export async function radioPress(env, cq) {
  const [, act, id] = String(cq.data).split(":");
  const chatId = cq.message?.chat?.id;
  const s = chatId && (await getSession(env, chatId));
  if (!s) return { answer: "Радио уже выключено. Напиши «сыграйбля радио <трек>»" };
  const now = Math.floor(Date.now() / 1000);
  if (act === "s") {
    await env.DB.prepare("DELETE FROM radio_session WHERE chat_id = ?").bind(chatId).run();
    return { answer: "Радио выключено", stop: true };
  }
  if (act === "n" || act === "d") {
    if (s.busy_until > now) return { answer: "Секунду, ещё грузится" };
  }
  const cur = s.cur?.id === id ? s.cur : { id, title: null, performer: null };
  if (act === "u" || act === "d") {
    await env.DB.prepare("INSERT INTO track_feedback (ts, user_id, video_id, title, performer, rating) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(now, cq.from.id, id, cur.title, cur.performer, act === "u" ? 1 : -1).run();
  }
  if (act === "u") {
    // 👍: следующий микс строим от этого трека; играть дальше — по кнопке «Дальше»
    await env.DB.prepare("UPDATE radio_session SET reseed = ?, updated = ? WHERE chat_id = ?").bind(id, now, chatId).run();
    return { answer: "Запомнил 👍", mark: "u" };
  }
  if (act === "d") {
    const bad = badKey(cur.performer);
    if (bad && !s.bad.includes(bad)) s.bad = [...s.bad, bad].slice(-30);
    s.queue = s.queue.filter((e) => e.id !== id);
    await env.DB.prepare("UPDATE radio_session SET bad = ?, queue = ?, reseed = NULL WHERE chat_id = ?").bind(JSON.stringify(s.bad), JSON.stringify(s.queue), chatId).run();
    await radioNext(env, s);
    return { answer: "Больше такого не будет", mark: "d" };
  }
  await radioNext(env, s);
  return { answer: "" };
}
