import { describe, expect, it } from "vitest";
import { ALIAS_RE, APOLOGY_RE, LOUD_RE, QUIET_RE, SLEEP_RE, WAKE_RE, parseDecision, reels, sleepHours } from "../worker/chat.js";

describe("обращение к боту", () => {
  it.each(["Санни, привет", "эй найдибот", "Sunny help", "саныч ты тут?"])("узнаёт %s", (t) => expect(ALIAS_RE.test(t)).toBe(true));
  it.each(["санитар", "sunnyside", "обычное сообщение"])("не срабатывает на %s", (t) => expect(ALIAS_RE.test(t)).toBe(false));
});

describe("команды-фразы", () => {
  it("сон и пробуждение", () => {
    expect(SLEEP_RE.test("Санни, иди поспи")).toBe(true);
    expect(SLEEP_RE.test("я пошёл спать")).toBe(false);
    expect(WAKE_RE.test("Санни, проснись")).toBe(true);
    expect(WAKE_RE.test("/wake")).toBe(true);
  });
  it("тише / громче", () => {
    expect(QUIET_RE.test("Санни, потише")).toBe(true);
    expect(QUIET_RE.test("потише")).toBe(false); // без имени не реагирует
    expect(LOUD_RE.test("Санни, громче")).toBe(true);
  });
  it("извинение", () => {
    expect(APOLOGY_RE.test("извини")).toBe(true);
    expect(APOLOGY_RE.test("сорян")).toBe(true);
    expect(APOLOGY_RE.test("привет")).toBe(false);
  });
});

describe("sleepHours", () => {
  it.each([["на 3 часа", 3], ["/sleep 12", 12], ["иди спать", 6], ["на 99 часов", 24], ["0", 6]])("%s -> %i", (t, n) => expect(sleepHours(t)).toBe(n));
});

describe("parseDecision", () => {
  it("чистый JSON", () => expect(parseDecision('{"action":"text","text":"привет"}', true)).toEqual({ action: "text", text: "привет" }));
  it("JSON в обёртке и с переносами в тексте", () => {
    expect(parseDecision('```json\n{"action":"text","text":"a\nb"}\n```', true).text).toBe("a\nb");
  });
  it("битый JSON с text и feel разбирается вручную", () => {
    const d = parseDecision('{"action":"text","text":"он сказал "привет"","feel":{"delta":1,"note":"добрый"}}', true);
    expect(d.text).toContain("привет");
    expect(d.feel).toEqual({ delta: 1, note: "добрый" });
  });
  it("сырой JSON никогда не уходит как текст", () => expect(parseDecision('{"action":"te', true)).toBeNull());
  it("обычный текст принимается только при прямом обращении", () => {
    expect(parseDecision("просто ответ", true)).toEqual({ action: "text", text: "просто ответ" });
    expect(parseDecision("просто ответ", false)).toBeNull();
  });
});

describe("reels", () => {
  it("1..64 даёт три символа, 1/22/43/64 — тройки одинаковых", () => {
    for (let v = 1; v <= 64; v++) expect(reels(v)).toHaveLength(3);
    for (const v of [1, 22, 43, 64]) expect(new Set(reels(v)).size).toBe(1);
    expect(new Set(reels(2)).size).toBeGreaterThan(1);
  });
});
