-- Журнал загрузок видео: пишет воркер по отчёту контейнера (POST /log-download).
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  user_id INTEGER,
  site TEXT NOT NULL,
  url TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  dl_ms INTEGER,
  recode_ms INTEGER,
  send_ms INTEGER
);
CREATE INDEX IF NOT EXISTS downloads_ts ON downloads (ts);
