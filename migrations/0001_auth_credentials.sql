CREATE TABLE IF NOT EXISTS auth_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  credential_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
