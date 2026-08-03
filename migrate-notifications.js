import "dotenv/config";
import { connectionPool } from "./utils/db.js";

const sql = `
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS author_id INTEGER REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id   INTEGER      REFERENCES users (id) ON DELETE SET NULL,
  type       VARCHAR(50)  NOT NULL,
  post_id    INTEGER      REFERENCES posts (id) ON DELETE CASCADE,
  comment_id INTEGER      REFERENCES comments (id) ON DELETE CASCADE,
  message    TEXT         NOT NULL,
  is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_author_id_idx ON posts (author_id);
`;

try {
  await connectionPool.query(sql);
  console.log("notifications migration ready");
} catch (error) {
  console.error("Failed to migrate notifications:", error.message);
  process.exitCode = 1;
} finally {
  await connectionPool.end();
}
