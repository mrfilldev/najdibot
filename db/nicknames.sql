-- Клички участников («Саня, @вася теперь звать Бубен»): бот называет человека так в ответах.
CREATE TABLE IF NOT EXISTS nicknames (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  nick TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
