import { Router } from "express";
import { connectionPool } from "../utils/db.js";
import { protect } from "../middlewares/protect.js";
import { notifyPostComment } from "./notifications.js";

// mergeParams: true เพื่ออ่าน :postId จาก parent path /posts/:postId/comments
const commentRouter = Router({ mergeParams: true });

const MAX_COMMENT_LENGTH = 2000;

function toComment(row) {
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    name: row.name,
    text: row.content,
    date: row.created_at.toISOString(),
    avatar: row.avatar,
  };
}

async function findPost(postId) {
  const result = await connectionPool.query(
    `SELECT id, title FROM posts WHERE id = $1`,
    [postId]
  );
  return result.rows[0] ?? null;
}

// GET /posts/:postId/comments — อ่านคอมเมนต์ของบทความนี้ (ไม่ต้อง login)
commentRouter.get("/", async (req, res) => {
  const postId = Number(req.params.postId);

  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  try {
    const existingPost = await findPost(postId);
    if (!existingPost) {
      return res.status(404).json({ message: "Post not found" });
    }

    const result = await connectionPool.query(
      `SELECT
         c.id,
         c.post_id,
         c.user_id,
         c.content,
         c.created_at,
         u.name,
         u.avatar
       FROM comments c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at DESC`,
      [postId]
    );

    return res.status(200).json(result.rows.map(toComment));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not read comments" });
  }
});

// POST /posts/:postId/comments — เขียนคอมเมนต์ (ต้อง login)
commentRouter.post("/", protect, async (req, res) => {
  const postId = Number(req.params.postId);
  const { content } = req.body ?? {};

  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  if (typeof content !== "string" || content.trim() === "") {
    return res.status(400).json({ message: "Comment content is required" });
  }

  const trimmed = content.trim();
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({
      message: `Comment must be at most ${MAX_COMMENT_LENGTH} characters`,
    });
  }

  try {
    const existingPost = await findPost(postId);
    if (!existingPost) {
      return res.status(404).json({ message: "Post not found" });
    }

    const result = await connectionPool.query(
      `INSERT INTO comments (post_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, post_id, user_id, content, created_at`,
      [postId, req.user.id, trimmed]
    );

    // ดึงชื่อผู้ใช้จาก database เพื่อให้ response ครบเหมือน GET
    const userResult = await connectionPool.query(
      `SELECT name, avatar FROM users WHERE id = $1`,
      [req.user.id]
    );

    const actorName = userResult.rows[0]?.name ?? "User";
    const row = {
      ...result.rows[0],
      name: actorName,
      avatar: userResult.rows[0]?.avatar ?? null,
    };

    // สร้างแจ้งเตือนให้เจ้าของบทความ (หรือ admin ถ้าบทความยังไม่มีเจ้าของ)
    try {
      await notifyPostComment({
        postId,
        commentId: result.rows[0].id,
        actorId: req.user.id,
        actorName,
        commentText: trimmed,
        articleTitle: existingPost.title,
      });
    } catch (notifyError) {
      // คอมเมนต์สำเร็จแล้ว ไม่ควร fail ทั้ง request เพราะแจ้งเตือนพลาด
      console.error("Failed to create comment notification:", notifyError);
    }

    return res.status(201).json(toComment(row));
  } catch (error) {
    // 23503 = foreign_key_violation (เช่น user ถูกลบไปแล้ว)
    if (error.code === "23503") {
      return res.status(400).json({ message: "Invalid post or user" });
    }
    console.error(error);
    return res.status(500).json({ message: "Could not create comment" });
  }
});

export default commentRouter;
