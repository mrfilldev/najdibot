// Мини-эмуляция D1 поверх встроенного node:sqlite: настоящий SQL и настоящие схемы из db/*.sql.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

export function fakeDB() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("db").filter((f) => f.endsWith(".sql"))) db.exec(readFileSync(`db/${f}`, "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
    all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
    first: async () => {
      const r = db.prepare(sql).get(...args);
      return r ? { ...r } : null;
    },
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}

// Подмена fetch к OpenRouter: возвращает заданный текст как ответ модели.
export function mockLLM(vi, reply) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    calls.push(JSON.parse(init.body));
    const text = typeof reply === "function" ? reply(calls.at(-1)) : reply;
    return { json: async () => ({ choices: [{ message: { content: text } }] }) };
  }));
  return calls;
}
