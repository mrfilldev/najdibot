// Telegram проверяет участника по числовому ID, а не по username.
export async function errorMention(tg, chatId, ownerId) {
  if (!ownerId) return '';
  try {
    const r = await (await tg('getChatMember', { chat_id: chatId, user_id: Number(ownerId) })).json();
    const m = r.ok && r.result;
    return m && (['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member)) ? ' @Fill_Dev' : '';
  } catch {
    return '';
  }
}
