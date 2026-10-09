-- Отношение Санни к конкретным людям: от -5 (бесит) до +5 (любимчик) с заметкой, почему.
CREATE TABLE IF NOT EXISTS feelings (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
