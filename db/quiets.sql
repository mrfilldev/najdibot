-- Режим «потише»: пока until в будущем, Санни не вбрасывает сам и отвечает только на прямое обращение.
CREATE TABLE IF NOT EXISTS quiets (
  chat_id INTEGER PRIMARY KEY,
  until INTEGER NOT NULL
);
