import { beforeEach, describe, expect, it } from "vitest";
import { nickReply, settingsCallback } from "../worker/settings.js";
import { nickPrompt, remember } from "../worker/chat.js";
import { fakeDB } from "./d1.js";

let env, calls, admins;
beforeEach(async () => {
  env = { DB: fakeDB() };
  calls = [];
  admins = new Set([1]);
  await remember(env, -1, 1, "Вася", "привет", 1, "vasya");
  await remember(env, -1, 2, "Петя", "привет", 2, "petya");
});

const tg = async (method, body) => {
  calls.push([method, body]);
  if (method === "getChatMember") return { json: async () => ({ result: { status: admins.has(body.user_id) ? "administrator" : "member" } }) };
  return { json: async () => ({}) };
};
const press = (userId, data) => settingsCallback(env, tg, { id: "q", data, from: { id: userId }, message: { chat: { id: -1, type: "supergroup" }, message_id: 9 } });
const sent = (method) => calls.filter(([m]) => m === method).map(([, b]) => b);
const ASK = (uid, name = "Петя") => `🏷 Кличка для #${uid} (${name}): ответь на это сообщение кличкой`;
const reply = (from, text, ask = ASK(2)) => nickReply(env, tg, { chat: { id: -1 }, message_id: 50, from: { id: from }, text, reply_to_message: { from: { is_bot: true }, text: ask } });
const nick = async (uid) => (await env.DB.prepare("SELECT nick FROM nicknames WHERE chat_id = -1 AND user_id = ?").bind(uid).first())?.nick;

describe("клички в /settings", () => {
  it("панель показывает всех, кого бот видел", async () => {
    await press(1, "st:n:0");
    const kb = sent("editMessageText")[0].reply_markup.inline_keyboard.flat().map((b) => b.text);
    expect(kb).toContain("▫️ Вася");
    expect(kb).toContain("▫️ Петя");
    expect(sent("editMessageText")[0].reply_markup.inline_keyboard.flat().map((b) => b.callback_data)).toContain("st:nu:2:0");
  });
  it("нажатие на человека просит кличку через force_reply", async () => {
    await press(1, "st:nu:2:0");
    const m = sent("sendMessage")[0];
    expect(m.text).toMatch(/^🏷 Кличка для #2 \(Петя\)/);
    expect(m.reply_markup.force_reply).toBe(true);
  });
  it("не-админ не может, пока админ не разрешил", async () => {
    await press(2, "st:nu:1:0");
    expect(sent("sendMessage")).toHaveLength(0);
    expect(sent("answerCallbackQuery")[0].text).toMatch(/админы/);
    await reply(2, "Бубен");
    expect(await nick(2)).toBeUndefined();
    expect(sent("sendMessage").at(-1).text).toMatch(/только админы/);
    await press(1, "st:who");
    await reply(2, "Бубен");
    expect(await nick(2)).toBe("Бубен");
  });
  it("ответ ставит кличку, она видна в панели и в промпте", async () => {
    expect(await reply(1, "«Бубен»")).toBe(true);
    expect(await nick(2)).toBe("Бубен");
    expect(sent("sendMessage").at(-1).text).toBe("Принято, теперь он «Бубен».");
    await press(1, "st:n:0");
    expect(sent("editMessageText").at(-1).reply_markup.inline_keyboard.flat().map((b) => b.text)).toContain("🏷 Петя — Бубен");
    expect(await nickPrompt(env, -1)).toContain("Петя = «Бубен»");
  });
  it("новая кличка заменяет старую, «-» убирает", async () => {
    await reply(1, "Бубен");
    await reply(1, "Туз");
    expect(await nick(2)).toBe("Туз");
    await reply(1, "-");
    expect(await nick(2)).toBeUndefined();
    expect(sent("sendMessage").at(-1).text).toBe("Кличку убрал.");
  });
  it("слишком короткая или длинная кличка отвергается", async () => {
    await reply(1, "а");
    await reply(1, "я".repeat(31));
    expect(await nick(2)).toBeUndefined();
    expect(sent("sendMessage").filter((m) => /от 2 до 30/.test(m.text))).toHaveLength(2);
  });
  it("посторонние ответы не трогаем", async () => {
    expect(await nickReply(env, tg, { chat: { id: -1 }, message_id: 5, from: { id: 1 }, text: "Бубен", reply_to_message: { from: { is_bot: true }, text: "что-то другое #2" } })).toBe(false);
    expect(await nickReply(env, tg, { chat: { id: -1 }, message_id: 5, from: { id: 1 }, text: "Бубен", reply_to_message: { from: { is_bot: false }, text: ASK(2) } })).toBe(false);
    expect(await nickReply(env, tg, { chat: { id: -1 }, message_id: 5, from: { id: 1 }, text: "Бубен" })).toBe(false);
    expect(await nick(2)).toBeUndefined();
  });
  it("кличка в другом чате не пересекается", async () => {
    await reply(1, "Бубен");
    expect((await env.DB.prepare("SELECT * FROM nicknames WHERE chat_id = -2").all()).results).toHaveLength(0);
  });
});
