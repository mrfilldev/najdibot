-- Активные «доёбы»: бот ведёт диалог с этим человеком, пока не кончатся ходы или время.
CREATE TABLE IF NOT EXISTS pokes (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  until INTEGER NOT NULL,
  left INTEGER NOT NULL,
  last INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
