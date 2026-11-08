import { beforeEach, describe, expect, it, vi } from "vitest";
import { RADIO_RE, badKey, getSession, radioPress, radioReport, radioStart } from "../worker/radio.js";
import { fakeDB } from "./d1.js";

let env, sent;
beforeEach(() => {
  sent = [];
  env = { DB: fakeDB(), DOWNLOADER_URL: "http://dl", WEBHOOK_SECRET: "s" };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => (sent.push([url, JSON.parse(init.body)]), { ok: true })));
});

const cq = (data, user = 7) => ({ id: "q", data, from: { id: user }, message: { chat: { id: 5 }, message_id: 9 } });
const track = (id, performer = "Исп") => ({ id, title: "Т" + id, performer });

describe("radio", () => {
  it("команда: радио + трек", () => {
    expect("сыграйбля радио Кино - Группа крови".match(RADIO_RE)[1]).toBe("Кино - Группа крови");
    expect("диджейбля радио x y".match(RADIO_RE)[1]).toBe("x y");
    expect(RADIO_RE.test("сыграйбля Кино")).toBe(false);
  });

  it("старт создаёт сессию и зовёт контейнер", async () => {
    await radioStart(env, 5, 1, "Кино");
    expect(sent[0][0]).toBe("http://dl/radio");
    expect(sent[0][1]).toMatchObject({ chat_id: 5, query: "Кино", queue: [] });
    expect((await getSession(env, 5)).busy_until).toBeGreaterThan(0);
  });

  it("отчёт контейнера кладёт трек в историю и снимает занятость", async () => {
    await radioStart(env, 5, 1, "Кино");
    await radioReport(env, { chat_id: 5, track: track("a1"), queue: [{ id: "b2" }] });
    const s = await getSession(env, 5);
    expect(s).toMatchObject({ played: ["a1"], busy_until: 0, queue: [{ id: "b2" }] });
    expect(s.cur.id).toBe("a1");
  });

  it("👍 пишет оценку и ставит reseed без следующего трека", async () => {
    await radioStart(env, 5, 1, "x");
    await radioReport(env, { chat_id: 5, track: track("a1"), queue: [] });
    sent.length = 0;
    const r = await radioPress(env, cq("rd:u:a1"));
    expect(r.mark).toBe("u");
    expect(sent).toHaveLength(0);
    expect((await getSession(env, 5)).reseed).toBe("a1");
    const fb = await env.DB.prepare("SELECT * FROM track_feedback").all();
    expect(fb.results[0]).toMatchObject({ user_id: 7, video_id: "a1", rating: 1, performer: "Исп" });
  });

  it("👎 исключает исполнителя, чистит очередь и просит следующий", async () => {
    await radioStart(env, 5, 1, "x");
    await radioReport(env, { chat_id: 5, track: track("a1", "Плохой - Topic"), queue: [{ id: "a1" }, { id: "b2" }] });
    sent.length = 0;
    const r = await radioPress(env, cq("rd:d:a1"));
    expect(r.mark).toBe("d");
    const body = sent[0][1];
    expect(body.bad).toEqual(["плохой"]);
    expect(body.queue.map((e) => e.id)).toEqual(["b2"]);
  });

  it("⏭ в период загрузки игнорируется (двойной тап)", async () => {
    await radioStart(env, 5, 1, "x");
    sent.length = 0;
    const r = await radioPress(env, cq("rd:n:a1"));
    expect(r.answer).toMatch(/Секунду/);
    expect(sent).toHaveLength(0);
  });

  it("⏹ удаляет сессию; без сессии — подсказка", async () => {
    await radioStart(env, 5, 1, "x");
    expect((await radioPress(env, cq("rd:s:a1"))).stop).toBe(true);
    expect(await getSession(env, 5)).toBeNull();
    expect((await radioPress(env, cq("rd:n:a1"))).answer).toMatch(/выключено/);
  });

  it("badKey убирает Topic и регистр", () => {
    expect(badKey("ABBA - Topic")).toBe("abba");
  });
});
