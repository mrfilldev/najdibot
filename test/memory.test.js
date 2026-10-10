import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { factsPrompt, forget, remember, updateFacts, sleepLeft, sleepStart, sleepEnd } from "../worker/chat.js";
import { fakeDB, mockLLM } from "./d1.js";

let env;
beforeEach(() => { env = { DB: fakeDB(), OPENROUTER_API_KEY: "k", LLM_MODEL: "m" }; });
afterEach(() => vi.unstubAllGlobals());

const fill = async (n = 10) => {
  for (let i = 0; i < n; i++) await remember(env, -1, i % 2 ? 2 : 1, i % 2 ? "Петя" : "Вася", `сообщение ${i}`);
};

describe("память сообщений", () => {
  it("remember пишет, обрезает до 500 символов, пустое пропускает", async () => {
    await remember(env, -1, 1, "Вася", "x".repeat(900), 5, "vasya");
    await remember(env, -1, 1, "Вася", "   ");
    const { results } = await env.DB.prepare("SELECT text, username FROM messages").all();
    expect(results).toHaveLength(1);
    expect(results[0].text).toHaveLength(500);
    expect(results[0].username).toBe("vasya");
  });
  it("forget стирает сообщения и факты только этого человека", async () => {
    await fill();
    await env.DB.prepare("INSERT INTO facts (chat_id,user_id,name,facts,updated) VALUES (-1,1,'Вася','кот',1),(-1,2,'Петя','пёс',1)").run();
    const n = await forget(env, -1, 1);
    expect(n).toBe(5);
    expect((await env.DB.prepare("SELECT * FROM facts").all()).results.map((r) => r.name)).toEqual(["Петя"]);
    expect((await env.DB.prepare("SELECT * FROM messages WHERE user_id=1").all()).results).toHaveLength(0);
  });
});

describe("долгая память (facts)", () => {
  it("мало сообщений: LLM не зовём", async () => {
    const calls = mockLLM(vi, "{}");
    await fill(3);
    expect(await updateFacts(env, -1)).toBe(0);
    expect(calls).toHaveLength(0);
  });
  it("сохраняет факты, режет длину/количество, игнорирует неизвестные имена", async () => {
    await fill();
    mockLLM(vi, 'Вот:\n' + JSON.stringify({ Вася: Array.from({ length: 15 }, (_, i) => `факт ${i} ${"я".repeat(200)}`), Незнакомец: ["x"], Петя: "не массив" }));
    expect(await updateFacts(env, -1)).toBe(1);
    const row = await env.DB.prepare("SELECT facts FROM facts WHERE user_id=1").first();
    const lines = row.facts.split("\n");
    expect(lines).toHaveLength(10);
    expect(lines.every((l) => l.length <= 100)).toBe(true);
    expect((await env.DB.prepare("SELECT * FROM facts").all()).results).toHaveLength(1);
  });
  it("повторный запуск перезаписывает, а не дублирует; старые факты уходят в промпт", async () => {
    await fill();
    mockLLM(vi, '{"Вася":["любит кофе"]}');
    await updateFacts(env, -1);
    const calls = mockLLM(vi, '{"Вася":["любит чай"]}');
    await updateFacts(env, -1);
    expect(calls[0].messages[1].content).toContain("любит кофе");
    const { results } = await env.DB.prepare("SELECT facts FROM facts WHERE user_id=1").all();
    expect(results).toEqual([{ facts: "любит чай" }]);
  });
  it("мусор от модели ничего не ломает", async () => {
    await fill();
    mockLLM(vi, "не json вообще");
    expect(await updateFacts(env, -1)).toBe(0);
    mockLLM(vi, "{сломанный json}");
    expect(await updateFacts(env, -1)).toBe(0);
  });
  it("factsPrompt: только нужные имена, пусто если нечего", async () => {
    await env.DB.prepare("INSERT INTO facts (chat_id,user_id,name,facts,updated) VALUES (-1,1,'Вася','любит кофе\nиграет в доту',1),(-1,2,'Петя','пёс',1)").run();
    const p = await factsPrompt(env, -1, ["Вася", undefined]);
    expect(p).toContain("Вася: любит кофе; играет в доту");
    expect(p).not.toContain("Петя");
    expect(await factsPrompt(env, -1, ["Никто"])).toBe("");
    expect(await factsPrompt(env, -1, [undefined])).toBe("");
    expect(await factsPrompt(env, -2, ["Вася"])).toBe("");
  });
});

describe("таймаут (sleeps)", () => {
  it("засыпает, считает остаток, просыпается", async () => {
    expect(await sleepLeft(env, -1)).toBe(0);
    await sleepStart(env, -1, 2);
    const left = await sleepLeft(env, -1);
    expect(left).toBeGreaterThan(7100);
    expect(left).toBeLessThanOrEqual(7200);
    await sleepEnd(env, -1);
    expect(await sleepLeft(env, -1)).toBe(0);
  });
});
