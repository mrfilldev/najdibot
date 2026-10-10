-- Долгая память: короткие устойчивые факты о человеке (обновляются из переписки дважды в сутки).
CREATE TABLE IF NOT EXISTS facts (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  facts TEXT NOT NULL DEFAULT '',
  updated INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
