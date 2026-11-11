import { afterEach, expect, it, vi } from 'vitest';
import { fakeDB, mockLLM } from './d1.js';
import { remember, forgetTopic, topicInstruction, FORGET_TOPIC_RE } from '../worker/chat.js';

afterEach(() => vi.unstubAllGlobals());
it('распознаёт команду без случайного совпадения с другими просьбами', () => {
  expect(FORGET_TOPIC_RE.test('Санни, забудь')).toBe(true);
  expect(FORGET_TOPIC_RE.test('Санни забудь про казино')).toBe(true);
  expect(FORGET_TOPIC_RE.test('Санни не забудь про казино')).toBe(false);
});
it('закрывает только указанную тему в одном чате, сохраняя сообщения', async () => {
  const env = { DB: fakeDB(), OPENROUTER_API_KEY: 'k', LLM_MODEL: 'm' };
  await remember(env, -1, 1, 'Петя', 'погода');
  await remember(env, -1, 0, 'Найдибот', 'я опять проиграл в казино');
  mockLLM(vi, 'проигрыш в казино');
  expect(await forgetTopic(env, -1)).toBe('проигрыш в казино');
  expect(await topicInstruction(env, -1)).toContain('проигрыш в казино');
  expect(await topicInstruction(env, -2)).toBe('');
  expect((await env.DB.prepare('SELECT * FROM messages').all()).results).toHaveLength(2);
});
it('не подтверждает сброс, когда тема не определена', async () => {
  const env = { DB: fakeDB(), OPENROUTER_API_KEY: 'k', LLM_MODEL: 'm' };
  mockLLM(vi, '');
  expect(await forgetTopic(env, -1)).toBeNull();
  expect(await topicInstruction(env, -1)).toBe('');
});

it('явная тема не требует запроса к модели и заменяет предыдущую', async () => {
  const env = { DB: fakeDB() };
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(await forgetTopic(env, -1, 'казино')).toBe('казино');
  expect(await forgetTopic(env, -1, 'футбол')).toBe('футбол');
  const rule = await topicInstruction(env, -1);
  expect(rule).toContain('футбол');
  expect(rule).not.toContain('казино');
  expect(rule).toContain('прямо спрашивают');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('передаёт закрытую тему модели и в серьёзном режиме', async () => {
  const { decide } = await import('../worker/chat.js');
  const env = { DB: fakeDB(), OPENROUTER_API_KEY: 'k', LLM_MODEL: 'm' };
  await forgetTopic(env, -1, 'казино');
  const calls = mockLLM(vi, '{"action":"text","text":"ответ"}');
  await decide(env, [], true, null, '', { name: 'Петя', text: 'объясни погоду' }, '', await topicInstruction(env, -1));
  expect(calls[0].messages[0].content).toContain('Тему «казино» попросили закрыть');
});
