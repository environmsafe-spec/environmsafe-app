-- Qimmah LMS schema
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('principal','teacher','student')),
  pass_hash   TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  last_login  INTEGER
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  k            TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '📘',
  color       TEXT NOT NULL DEFAULT '#2563eb',
  position    INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_units_subject ON units(subject_id, position);

CREATE TABLE lessons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lessons_unit ON lessons(unit_id, position);

-- kind: text | video | audio | file | link | book
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('text','video','audio','file','link','book')),
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  media_id    TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_lesson ON items(lesson_id, position);

CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE quizzes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id      INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  lesson_id    INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  pass_percent INTEGER NOT NULL DEFAULT 50,
  max_attempts INTEGER NOT NULL DEFAULT 0,
  show_answers INTEGER NOT NULL DEFAULT 1,
  shuffle      INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_quizzes_unit ON quizzes(unit_id);
CREATE INDEX idx_quizzes_lesson ON quizzes(lesson_id);

-- kind: mcq | tf | short ; options/answer are JSON
CREATE TABLE questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id     INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('mcq','tf','short')),
  text        TEXT NOT NULL,
  options     TEXT NOT NULL DEFAULT '[]',
  answer      TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 1,
  explanation TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_questions_quiz ON questions(quiz_id, position);

CREATE TABLE attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id      INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        REAL NOT NULL,
  max_score    REAL NOT NULL,
  percent      INTEGER NOT NULL,
  passed       INTEGER NOT NULL,
  answers      TEXT NOT NULL,
  submitted_at INTEGER NOT NULL
);
CREATE INDEX idx_attempts_user ON attempts(user_id, submitted_at);
CREATE INDEX idx_attempts_quiz ON attempts(quiz_id);

CREATE TABLE progress (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_time ON audit(created_at);
