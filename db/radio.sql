-- Радио по треку: состояние сессии на чат и оценки треков (основа будущего профиля вкуса).
CREATE TABLE IF NOT EXISTS radio_session (
  chat_id INTEGER PRIMARY KEY,
  queue TEXT NOT NULL DEFAULT '[]',   -- JSON: [{id,title,channel,duration}] ещё не сыгранные из YouTube Mix
  played TEXT NOT NULL DEFAULT '[]',  -- JSON: id сыгранных
  bad TEXT NOT NULL DEFAULT '[]',     -- JSON: исполнители/каналы с 👎 (исключаем в этой сессии)
  cur TEXT,                           -- JSON: {id,title,performer} последнего присланного
  reseed TEXT,                        -- id трека с 👍: следующий микс строим от него
  busy_until INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS track_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  performer TEXT,
  rating INTEGER NOT NULL            -- 1 = нравится, -1 = не нравится
);
CREATE INDEX IF NOT EXISTS track_feedback_user ON track_feedback (user_id, ts);
