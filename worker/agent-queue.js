import { maybeChat } from './chat.js';
import { tgBase } from './remote.js';

// Один Durable Object на чат: сообщения сохраняются до завершения обработки.
export class AgentQueue {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const msg = await request.json();
    await this.state.storage.transaction(async tx => {
      const jobs = await tx.get('jobs') || [];
      if (!jobs.some(job => job.message_id === msg.message_id)) jobs.push(msg);
      await tx.put('jobs', jobs);
      await tx.setAlarm(Date.now() + 1000);
    });
    return new Response('ok');
  }

  async alarm() {
    const jobs = await this.state.storage.get('jobs') || [];
    if (!jobs.length) return;
    // Повторный alarm поднимет очередь, если экземпляр прервётся во время работы.
    await this.state.storage.setAlarm(Date.now() + 300_000);
    let failed = false;
    try {
      const tg = async (method, body) => {
        const r = await fetch(`${tgBase(this.env)}/bot${this.env.BOT_TOKEN}/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
        });
        const result = await r.clone().json();
        if (!r.ok || !result.ok) throw new Error(`Telegram ${method}: ${result.description || r.status}`);
        return r;
      };
      await maybeChat(this.env, jobs[0], tg, { forced: true, queued: true });
    } catch (e) {
      failed = true;
      console.error('agent queue failed:', e.message);
    } finally {
      await this.state.storage.transaction(async tx => {
        const pending = await tx.get('jobs') || [];
        if (pending[0]?.message_id === jobs[0].message_id) {
          if (failed && (pending[0].__agent_attempts || 0) < 2) pending[0].__agent_attempts = (pending[0].__agent_attempts || 0) + 1;
          else pending.shift();
        }
        await tx.put('jobs', pending);
        if (pending.length) await tx.setAlarm(Date.now() + (failed ? 10_000 : 1000));
        else await tx.deleteAlarm();
      });
    }
  }
}
