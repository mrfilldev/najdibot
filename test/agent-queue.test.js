import { describe, it, expect } from 'vitest';
import { AgentQueue } from '../worker/agent-queue.js';

function storage() {
  const data = new Map();
  const s = { get: async k => data.get(k), put: async (k,v) => data.set(k,v), setAlarm: async () => {}, deleteAlarm: async () => {} }; s.transaction = async fn => fn(s); return s;
}
describe('очередь агента', () => {
  it('сохраняет обращения по порядку и не теряет их после сбоя', async () => {
    const s = storage();
    const q = new AgentQueue({ storage: s }, {});
    await q.fetch(new Request('https://queue/', { method: 'POST', body: JSON.stringify({ message_id: 1 }) }));
    await q.fetch(new Request('https://queue/', { method: 'POST', body: JSON.stringify({ message_id: 2 }) }));
    expect((await s.get('jobs')).map(j => j.message_id)).toEqual([1, 2]);
  });
});

import { decide } from '../worker/chat.js';
import { vi, afterEach } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('в прямом обращении учитывает только недавний контекст', async () => {
  let prompt;
  vi.stubGlobal('fetch', async (url, init) => {
    prompt = JSON.parse(init.body).messages[1].content;
    return { json: async () => ({ choices: [{ message: { content: '{"action":"text","text":"ответ"}' } }] }) };
  });
  const rows = Array.from({ length: 12 }, (_, i) => ({ name: 'участник', text: `тема ${i}` }));
  await decide({ OPENROUTER_API_KEY: 'key', LLM_MODEL: 'model' }, rows, true, null, '', { name: 'участник', text: 'новая тема' });
  expect(prompt).not.toContain('тема 0');
  expect(prompt).toContain('новая тема');
});

import { history, remember } from '../worker/chat.js';
import { fakeDB } from './d1.js';
it('контекст ожидающего вопроса не включает сообщения, пришедшие после него', async () => {
  const env = { DB: fakeDB() };
  await remember(env, -1, 1, 'Аня', 'первый вопрос', 10);
  await remember(env, -1, 2, 'Борис', 'совсем другая тема', 11);
  const rows = await history(env, -1, 10);
  expect(rows.map(row => row.text)).toEqual(['первый вопрос']);
});
