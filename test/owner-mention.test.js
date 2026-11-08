import { describe, expect, it } from 'vitest';
import { errorMention } from '../container/owner.mjs';

describe('упоминание владельца при ошибке', () => {
  const api = (result) => async () => ({ json: async () => result });
  it.each(['member', 'administrator', 'creator'])('упоминает участника со статусом %s', async (status) => {
    expect(await errorMention(api({ ok: true, result: { status } }), -1, 123)).toBe(' @Fill_Dev');
  });
  it.each([{ status: 'left' }, { status: 'kicked' }, { status: 'restricted', is_member: false }])('не упоминает отсутствующего участника %o', async (result) => {
    expect(await errorMention(api({ ok: true, result }), -1, 123)).toBe('');
  });
  it('упоминает ограниченного участника чата', async () => {
    expect(await errorMention(api({ ok: true, result: { status: 'restricted', is_member: true } }), -1, 123)).toBe(' @Fill_Dev');
  });
  it('не упоминает, если ID неизвестен или проверка не удалась', async () => {
    expect(await errorMention(api({ ok: true }), -1, null)).toBe('');
    expect(await errorMention(async () => { throw new Error('offline'); }, -1, 123)).toBe('');
  });
});
