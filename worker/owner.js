import { errorMention } from '../container/owner.mjs';

// Владельцы бота (OWNER_IDS через запятую): настраивают бота и модерируют в любом чате, админы они там или нет.
export const ownerIds = (env) => String(env.OWNER_IDS || env.OWNER_ID || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
export const isOwner = (env, userId) => ownerIds(env).includes(Number(userId));

export async function ownerId(env) {
  if (ownerIds(env)[0]) return ownerIds(env)[0];
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
