-- Отложенные «позови всех в дискорд»: когда at (unix, сек) наступит, cron тегает всех в чате.
CREATE TABLE IF NOT EXISTS discord_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  by_name TEXT NOT NULL DEFAULT ''
);
