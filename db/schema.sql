-- Память бота о чатах: последние сообщения (хвост обрезается кодом).
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER,
  user_id INTEGER,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL,
  username TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (chat_id, user_id);
