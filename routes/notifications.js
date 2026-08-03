import { Router } from "express";
import { connectionPool } from "../utils/db.js";
import { protect } from "../middlewares/protect.js";

const notificationRouter = Router();

function toNotification(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    quote: row.quote,
    articleTitle: row.article_title,
    postId: row.post_id,
    commentId: row.comment_id,
    isRead: row.is_read,
    time: row.created_at.toISOString(),
    name: row.actor_name,
    avatar: row.actor_avatar,
  };
}

// GET /notifications — รายการแจ้งเตือนของคนที่ login อยู่ (ใหม่สุดก่อน)
notificationRouter.get("/", protect, async (req, res) => {
  try {
    const result = await connectionPool.query(
      `SELECT
         n.id,
         n.type,
         n.message,
         n.is_read,
         n.post_id,
         n.comment_id,
         n.created_at,
         c.content AS quote,
         p.title AS article_title,
         u.name AS actor_name,
         u.avatar AS actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       LEFT JOIN posts p ON p.id = n.post_id
       LEFT JOIN comments c ON c.id = n.comment_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    return res.status(200).json(result.rows.map(toNotification));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not read notifications" });
  }
});

// GET /notifications/unread-count — จำนวนที่ยังไม่อ่าน (จุดแดง NavBar)
notificationRouter.get("/unread-count", protect, async (req, res) => {
  try {
    const result = await connectionPool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );

    return res.status(200).json({ count: result.rows[0].count });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not count notifications" });
  }
});

// PATCH /notifications/read — ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
notificationRouter.patch("/read", protect, async (req, res) => {
  try {
    await connectionPool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );

    return res.status(200).json({ message: "Notifications marked as read" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not update notifications" });
  }
});

export default notificationRouter;

/**
 * สร้างแจ้งเตือนเมื่อมีคน comment บทความ
 * - ถ้าบทความมี author_id → แจ้งเจ้าของบทความ
 * - ถ้าไม่มี (เช่นบทความจาก seed) → แจ้ง admin ทุกคน
 * - ไม่แจ้งตัวเอง (ถ้าคน comment คือเจ้าของบทความ)
 */
export async function notifyPostComment({
  postId,
  commentId,
  actorId,
  actorName,
  commentText,
  articleTitle,
}) {
  const postResult = await connectionPool.query(
    `SELECT author_id FROM posts WHERE id = $1`,
    [postId]
  );

  if (postResult.rows.length === 0) return;

  const authorId = postResult.rows[0].author_id;
  let recipientIds = [];

  if (authorId) {
    recipientIds = [authorId];
  } else {
    const admins = await connectionPool.query(
      `SELECT id FROM users WHERE role = 'admin'`
    );
    recipientIds = admins.rows.map((row) => row.id);
  }

  recipientIds = recipientIds.filter((id) => id !== actorId);
  if (recipientIds.length === 0) return;

  const message = `commented on your article: ${articleTitle}`;
  // เก็บ quote สั้น ๆ ใน message ไม่จำเป็น เพราะดึงจาก comments ได้
  // แต่เก็บข้อความหลักไว้ในคอลัมน์ message เพื่อแสดงแม้ comment ถูกลบ

  const values = [];
  const placeholders = [];

  recipientIds.forEach((userId, index) => {
    const offset = index * 6;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
    );
    values.push(userId, actorId, "comment", postId, commentId, message);
  });

  await connectionPool.query(
    `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, message)
     VALUES ${placeholders.join(", ")}`,
    values
  );

  // actorName / commentText ใช้เพื่อ debug ได้ถ้าต้องการ ไม่บังคับเก็บซ้ำ
  void actorName;
  void commentText;
}
