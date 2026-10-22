import { beforeEach, describe, expect, it } from "vitest";
import { featureOn, getSettings, optedOut, resolveNames, setOptout, settingsCallback } from "../worker/settings.js";
import { remember } from "../worker/chat.js";
import { fakeDB } from "./d1.js";

let env, calls, admins;
beforeEach(async () => {
  env = { DB: fakeDB() };
  calls = [];
  admins = new Set([1]);
  await remember(env, -1, 1, "Вася", "привет", 1, "vasya");
  await remember(env, -1, 2, "Петя", "привет", 2, "petya");
  await remember(env, -1, 3, "Игорь", "привет", 3, null);
});

// tg-заглушка: getChatMember отвечает по списку админов, остальное записываем.
const tg = async (method, body) => {
  calls.push([method, body]);
  if (method === "getChatMember") return { json: async () => ({ result: { status: admins.has(body.user_id) ? "administrator" : "member" } }) };
  return { json: async () => ({}) };
};
const press = (userId, data, chat = -1) => settingsCallback(env, tg, { id: "q", data, from: { id: userId }, message: { chat: { id: chat, type: "supergroup" }, message_id: 9 } });
const answers = () => calls.filter(([m]) => m === "answerCallbackQuery").map(([, b]) => b.text);

describe("настройки функций", () => {
  it("по умолчанию всё включено, админ выключает", async () => {
    expect(featureOn(await getSettings(env, -1), "casino")).toBe(true);
    await press(1, "st:casino");
    expect(featureOn(await getSettings(env, -1), "casino")).toBe(false);
    await press(1, "st:casino");
    expect(featureOn(await getSettings(env, -1), "casino")).toBe(true);
  });
  it("не-админ не может, пока админ не разрешил", async () => {
    await press(2, "st:casino");
    expect(featureOn(await getSettings(env, -1), "casino")).toBe(true);
    expect(answers().at(-1)).toMatch(/админы/);
    await press(2, "st:who"); // сам разрешить не может
    expect((await getSettings(env, -1)).who).toBe("admins");
    await press(1, "st:who");
    await press(2, "st:casino");
    expect(featureOn(await getSettings(env, -1), "casino")).toBe(false);
  });
  it("настройки хранятся по чатам и переживают сброс кэша", async () => {
    await press(1, "st:poke");
    expect(featureOn(await getSettings(env, -2), "poke")).toBe(true);
    const row = await env.DB.prepare("SELECT flags FROM chat_settings WHERE chat_id=-1").first();
    expect(JSON.parse(row.flags).poke).toBe(false);
  });
  it("в личке кнопки игнорируются", async () => {
    await settingsCallback(env, tg, { id: "q", data: "st:casino", from: { id: 1 }, message: { chat: { id: 5, type: "private" }, message_id: 1 } });
    expect(calls.some(([m]) => m === "editMessageText")).toBe(false);
  });
});

describe("кого звать", () => {
  it("отписка и возврат", async () => {
    await setOptout(env, -1, 2, true);
    expect([...(await optedOut(env, -1))]).toEqual([2]);
    await setOptout(env, -1, 2, false);
    expect((await optedOut(env, -1)).size).toBe(0);
  });
  it("кнопка в списке переключает человека (админ), не-админ нет", async () => {
    await press(1, "st:u:2:0");
    expect((await optedOut(env, -1)).has(2)).toBe(true);
    await press(3, "st:u:3:0");
    expect((await optedOut(env, -1)).has(3)).toBe(false);
    await press(1, "st:u:2:0");
    expect((await optedOut(env, -1)).has(2)).toBe(false);
  });
  it("«кроме»: имена с падежами, @username, ненайденные", async () => {
    const r = await resolveNames(env, -1, "Васи и @petya, Колю");
    expect(r.ids.sort()).toEqual([1, 2]);
    expect(r.missing).toEqual(["Колю"]);
  });
  it("панели рисуются без ошибок", async () => {
    await press(1, "st:p:0");
    await press(1, "st:back");
    expect(calls.filter(([m]) => m === "editMessageText").length).toBe(2);
  });
});
