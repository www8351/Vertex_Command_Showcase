CREATE TABLE IF NOT EXISTS linked_users (
  id SERIAL PRIMARY KEY,
  primary_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT linked_users_pair_unique UNIQUE (primary_user_id, linked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_linked_users_primary ON linked_users(primary_user_id);
CREATE INDEX IF NOT EXISTS idx_linked_users_linked ON linked_users(linked_user_id);
