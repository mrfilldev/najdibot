import { beforeEach, describe, expect, it, vi } from "vitest";
import { RADIO_AHEAD, RADIO_RE, badKey, getSession, radioPress, radioReport, radioStart } from "../worker/radio.js";
import { fakeDB } from "./d1.js";

let env, sent, deleted;
beforeEach(() => {
  sent = [];
  deleted = [];
  env = { DB: fakeDB(), DOWNLOADER_URL: "http://dl", WEBHOOK_SECRET: "s" };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => (sent.push([url, JSON.parse(init.body)]), { ok: true })));
});

const del = async (mids) => deleted.push(...mids);
const cq = (data, mid, user = 7) => ({ id: "q", data, from: { id: user }, message: { chat: { id: 5 }, message_id: mid } });
const rep = (id, mid, gen, performer = "Исп", queue = []) => radioReport(env, { chat_id: 5, gen, mid, track: { id, title: "Т" + id, performer }, queue });
// Сессия, в которой уже прислано три трека (сообщения 10, 11, 12)
async function started() {
  await radioStart(env, 5, 1, "Кино");
  const gen = (await getSession(env, 5)).gen;
  for (const [i, id] of ["a", "b", "c"].entries()) await rep(id, 10 + i, gen, id === "a" ? "Плохой - Topic" : "Исп", [{ id: "q1" }, { id: "c" }]);
  sent.length = 0;
}

describe("radio без запроса", () => {
  const like = (user, id, rating = 1) => env.DB.prepare("INSERT INTO track_feedback (ts, user_id, video_id, rating) VALUES (1, ?, ?, ?)").bind(user, id, rating).run();
  it("нет ♡ — ничего не запускает", async () => {
    expect(await radioStart(env, 5, 1, null, 7)).toEqual({ empty: true });
    expect(sent.length).toBe(0);
  });
  it("затравка из ♡ пользователя, забракованные и чужие не берутся", async () => {
    await like(7, "good");
    await like(7, "bad");
    await like(7, "bad", -1);
    await like(8, "other");
    expect(await radioStart(env, 5, 1, null, 7)).toEqual({ empty: false });
    const body = sent[0][1];
    expect(body.query).toBeNull();
    expect(body.reseed).toBe("good");
    expect(body.played).toEqual(["good"]);
  });
});

describe("radio", () => {
  it("команда: радио + трек", () => {
    expect("сыграйбля радио Кино - Группа крови".match(RADIO_RE)[1]).toBe("Кино - Группа крови");
    expect("диджейбля радио x y".match(RADIO_RE)[1]).toBe("x y");
    expect(RADIO_RE.test("сыграйбля Кино")).toBe(false);
    expect(RADIO_RE.test("сыграйбля радио")).toBe(true);
    expect("сыграйбля радио".match(RADIO_RE)[1]).toBeUndefined();
    expect(RADIO_RE.test("сыграйбля радиотехника")).toBe(false);
  });

  it("старт просит у контейнера RADIO_AHEAD треков и новое поколение", async () => {
    await radioStart(env, 5, 1, "Кино");
    expect(sent[0][0]).toBe("http://dl/radio");
    expect(sent[0][1]).toMatchObject({ chat_id: 5, query: "Кино", count: RADIO_AHEAD, gen: 1 });
    await radioStart(env, 5, 2, "Гуф");
    expect(sent[1][1].gen).toBe(2);
  });

  it("отчёт копит присланные треки; устаревшее поколение прерывается", async () => {
    await started();
    const s = await getSession(env, 5);
    expect(s.sent.map((e) => e.mid)).toEqual([10, 11, 12]);
    expect(s.played).toEqual(["a", "b", "c"]);
    expect(await rep("zz", 13, s.gen - 1)).toEqual({ abort: true });
    expect((await getSession(env, 5)).sent).toHaveLength(3);
  });

  it("♡ на втором треке: удаляет хвост, пишет оценку, строит микс от него", async () => {
    await started();
    const g0 = (await getSession(env, 5)).gen;
    const r = await radioPress(env, cq("rd:u:b", 11), del);
    expect(r.mark).toBe("u");
    expect(deleted).toEqual([12]);
    expect(sent[0][1]).toMatchObject({ count: RADIO_AHEAD - 1, reseed: "b", gen: g0 + 1 });
    const s = await getSession(env, 5);
    expect(s.sent.map((e) => e.mid)).toEqual([10, 11]);
    const fb = await env.DB.prepare("SELECT * FROM track_feedback").all();
    expect(fb.results[0]).toMatchObject({ user_id: 7, video_id: "b", rating: 1, performer: "Исп" });
  });

  it("♡̸ — только про трек: оценка пишется, поток и хвост не трогаются", async () => {
    await started();
    const g0 = (await getSession(env, 5)).gen;
    const r = await radioPress(env, cq("rd:d:a", 10), del);
    expect(r.mark).toBe("d");
    expect(deleted).toEqual([]);
    expect(sent).toHaveLength(0);
    const s = await getSession(env, 5);
    expect(s.gen).toBe(g0);
    expect(s.bad).toEqual([]);
    expect(s.sent).toHaveLength(3);
    const fb = await env.DB.prepare("SELECT * FROM track_feedback").all();
    expect(fb.results[0]).toMatchObject({ video_id: "a", rating: -1, performer: "Плохой - Topic" });
  });

  it("⏭ докачивает буфер, а при полном просит жать в плеере", async () => {
    await started();
    const r = await radioPress(env, cq("rd:n:a", 10), del);
    expect(r.answer).toBe("");
    expect(sent[0][1].count).toBe(RADIO_AHEAD - 1 - 2);
    expect(deleted).toEqual([]);
  });

  it("■ удаляет сессию и хвост; без сессии — подсказка", async () => {
    await started();
    expect((await radioPress(env, cq("rd:s:a", 10), del)).stop).toBe(true);
    expect(deleted).toEqual([11, 12]);
    expect(await getSession(env, 5)).toBeNull();
    expect((await radioPress(env, cq("rd:n:a", 10), del)).answer).toMatch(/выключено/);
    expect(await rep("x", 20, 1)).toEqual({ abort: true });
  });

  it("badKey убирает Topic и регистр", () => {
    expect(badKey("ABBA - Topic")).toBe("abba");
  });
});
