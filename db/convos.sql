-- Живой диалог: пока человек разговаривает с ботом, его реплики без имени тоже считаются обращением.
CREATE TABLE IF NOT EXISTS convos (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  until INTEGER NOT NULL,
  left INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
