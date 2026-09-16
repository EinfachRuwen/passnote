CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'temporary',
  password_hash TEXT,
  max_users INTEGER NOT NULL DEFAULT 50,
  canvas_data TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_slug ON rooms(slug);
CREATE INDEX IF NOT EXISTS idx_rooms_cleanup ON rooms(type, last_active_at);
