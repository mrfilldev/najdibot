import { errorMention } from '../container/owner.mjs';

export async function ownerId(env) {
  if (env.OWNER_ID) return Number(env.OWNER_ID) || null;
  try {
    const row = await env.DB.prepare('SELECT user_id FROM messages WHERE lower(username)=lower(?) AND user_id > 0 ORDER BY id DESC LIMIT 1').bind('Fill_Dev').first();
    return row?.user_id || null;
  } catch {
    return null;
  }
}

export async function ownerMention(env, tg, chatId) {
  return errorMention(tg, chatId, await ownerId(env));
}
