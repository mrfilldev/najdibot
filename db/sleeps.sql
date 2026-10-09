-- Таймаут Санни: пока until в будущем, бот в этом чате молчит (кроме реакции 😴 на обращение).
CREATE TABLE IF NOT EXISTS sleeps (
  chat_id INTEGER PRIMARY KEY,
  until INTEGER NOT NULL
);
