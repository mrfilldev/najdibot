-- Предупреждения участников для /warn (после 3 — автомьют на час).
CREATE TABLE IF NOT EXISTS warns (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
