// Модерация чата: команды только для админов, цель — автор сообщения, на которое ответили.
// Боту нужны права админа: «удалять сообщения» и «блокировать пользователей».

export const MOD_CMD = /^\/(mute|unmute|ban|unban|kick|del|warn|unwarn|warns)(@\w+)?(?:\s+(\d+))?/i;

const WARN_LIMIT = 3;
const WARN_MUTE_MIN = 60;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (u) => `<a href="tg://user?id=${u.id}">${esc(u.first_name || u.username || "участник")}</a>`;

async function api(tg, method, body) {
  return (await tg(method, body)).json();
}

const isAdmin = async (tg, chatId, userId) => {
  const r = await api(tg, "getChatMember", { chat_id: chatId, user_id: userId });
  return ["creator", "administrator"].includes(r.result?.status);
};

const MUTED = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false };
const FREE = Object.fromEntries(Object.keys(MUTED).map((k) => [k, true]));

// reply(text) отправляет HTML-ответ на команду; tg(method, body) — вызов Bot API.
export async function moderate({ env, tg, reply, msg, cmd, arg, ownId }) {
  const chatId = msg.chat.id;
  if (!(await isAdmin(tg, chatId, msg.from.id))) return reply("Эта команда только для админов.");
  const target = msg.reply_to_message?.from;
  if (!target) return reply("Ответь этой командой на сообщение нужного человека.");
  if (target.is_bot || target.id === ownId) return reply("Ботов не трогаю.");
  if (await isAdmin(tg, chatId, target.id)) return reply("Админов не трогаю.");

  const who = link(target);
  const fail = (r) => reply(`Не вышло: ${esc(r.description ?? "неизвестная ошибка")}. @Fill_Dev Проверь, что я админ с правами «удалять сообщения» и «блокировать пользователей».`);
  const now = Math.floor(Date.now() / 1000);

  if (cmd === "mute") {
    const min = Math.min(Math.max(Number(arg) || 10, 1), 10080);
    const r = await api(tg, "restrictChatMember", { chat_id: chatId, user_id: target.id, permissions: MUTED, until_date: now + min * 60 });
    return r.ok ? reply(`${who} заткнулся на ${min} мин.`) : fail(r);
  }
  if (cmd === "unmute") {
    const r = await api(tg, "restrictChatMember", { chat_id: chatId, user_id: target.id, permissions: FREE });
    return r.ok ? reply(`${who} снова может писать.`) : fail(r);
  }
  if (cmd === "ban") {
    const r = await api(tg, "banChatMember", { chat_id: chatId, user_id: target.id });
    return r.ok ? reply(`${who} забанен.`) : fail(r);
  }
  if (cmd === "unban") {
    const r = await api(tg, "unbanChatMember", { chat_id: chatId, user_id: target.id, only_if_banned: true });
    return r.ok ? reply(`${who} разбанен.`) : fail(r);
  }
  if (cmd === "kick") {
    const r = await api(tg, "banChatMember", { chat_id: chatId, user_id: target.id });
    if (!r.ok) return fail(r);
    await api(tg, "unbanChatMember", { chat_id: chatId, user_id: target.id, only_if_banned: true }); // выгнать, но не банить навсегда
    return reply(`${who} выгнан (вернуться по ссылке может).`);
  }
  if (cmd === "del") {
    const r = await api(tg, "deleteMessage", { chat_id: chatId, message_id: msg.reply_to_message.message_id });
    await api(tg, "deleteMessage", { chat_id: chatId, message_id: msg.message_id }); // и саму команду
    return r.ok ? null : fail(r);
  }

  // предупреждения: хранятся в D1, на третьем автомьют на час и счётчик обнуляется
  const key = [chatId, target.id];
  if (cmd === "warns") {
    const row = await env.DB.prepare("SELECT count FROM warns WHERE chat_id=? AND user_id=?").bind(...key).first();
    return reply(`У ${who} предупреждений: ${row?.count ?? 0} из ${WARN_LIMIT}.`);
  }
  if (cmd === "unwarn") {
    await env.DB.prepare("DELETE FROM warns WHERE chat_id=? AND user_id=?").bind(...key).run();
    return reply(`Предупреждения ${who} сброшены.`);
  }
  if (cmd === "warn") {
    await env.DB.prepare("INSERT INTO warns (chat_id, user_id, count) VALUES (?,?,1) ON CONFLICT(chat_id, user_id) DO UPDATE SET count = count + 1").bind(...key).run();
    const { count } = await env.DB.prepare("SELECT count FROM warns WHERE chat_id=? AND user_id=?").bind(...key).first();
    if (count < WARN_LIMIT) return reply(`${who}, предупреждение ${count} из ${WARN_LIMIT}.`);
    const r = await api(tg, "restrictChatMember", { chat_id: chatId, user_id: target.id, permissions: MUTED, until_date: now + WARN_MUTE_MIN * 60 });
    await env.DB.prepare("DELETE FROM warns WHERE chat_id=? AND user_id=?").bind(...key).run();
    return r.ok ? reply(`${who} собрал ${WARN_LIMIT} предупреждения и заткнулся на ${WARN_MUTE_MIN} мин.`) : fail(r);
  }
}
