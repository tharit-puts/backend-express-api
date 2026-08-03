import "dotenv/config";
import { connectionPool } from "./utils/db.js";

const sql = `
CREATE TABLE IF NOT EXISTS comments (
  id         SERIAL PRIMARY KEY,
  post_id    INTEGER      NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id    INTEGER      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content    TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comments_post_id_idx ON comments (post_id);
CREATE INDEX IF NOT EXISTS comments_created_at_idx ON comments (created_at DESC);
`;

try {
  await connectionPool.query(sql);
  const result = await connectionPool.query(
    `SELECT to_regclass('public.comments') AS name`
  );
  console.log("comments table ready:", result.rows[0].name);
} catch (error) {
  console.error("Failed to create comments table:", error.message);
  process.exitCode = 1;
} finally {
  await connectionPool.end();
}
