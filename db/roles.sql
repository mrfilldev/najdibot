-- Роль Санни («прикинься Вархаммером»): пока until в будущем, он отвечает в образе.
CREATE TABLE IF NOT EXISTS roles (
  chat_id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  until INTEGER NOT NULL
);
