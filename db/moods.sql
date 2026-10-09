-- Настроение Санни по чату: само меняется со временем и от событий (казино, ревность, обиды).
CREATE TABLE IF NOT EXISTS moods (
  chat_id INTEGER PRIMARY KEY,
  mood TEXT NOT NULL,
  intensity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  updated INTEGER NOT NULL
);
