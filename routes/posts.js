import { Router } from "express";
import { connectionPool } from "../utils/db.js";
import { attachUserIfPresent, protect } from "../middlewares/protect.js";

const postRouter = Router();

// frontend แบ่งเนื้อหาเป็นหัวข้อด้วย regex ตัวนี้ (split(/## \d+\.\s/))
// ถ้า content ไม่มีหัวข้อรูปแบบ "## 1. " เลย หน้าเว็บจะแสดงเนื้อหาไม่ได้
const HEADING_PATTERN = /## \d+\.\s/;

// คอลัมน์ที่ทุก query ใช้ร่วมกัน
// JOIN categories เพื่อดึง "ชื่อ" หมวดหมู่ออกมาเป็น category (frontend ต้องการ string ไม่ใช่ category_id)
const POST_COLUMNS = `
  p.id,
  p.title,
  p.description,
  p.content,
  c.name AS category,
  p.author,
  p.author_id,
  u.avatar AS author_avatar,
  u.bio AS author_bio,
  p.image,
  p.likes,
  p.status,
  p.created_at
`;

const POST_FROM = `
  FROM posts p
  INNER JOIN categories c ON c.id = p.category_id
  LEFT JOIN users u ON u.id = p.author_id
`;

// แปลงแถวจาก database ให้เป็นรูปแบบที่ frontend ต้องการ
function toPost(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    category: row.category,
    author: row.author,
    authorId: row.author_id ?? null,
    authorAvatar: row.author_avatar ?? null,
    authorBio: row.author_bio ?? null,
    image: row.image,
    date: row.created_at.toISOString(),
    likes: row.likes,
    status: row.status,
  };
}

// ใน LIKE/ILIKE ตัว % และ _ เป็นอักขระพิเศษ
// ถ้าผู้ใช้ค้นคำว่า "50%" เราต้อง escape ไม่ให้ % กลายเป็น wildcard
function escapeLikePattern(text) {
  return text.replace(/[!%_]/g, (char) => `!${char}`);
}

// สร้าง WHERE + ค่าพารามิเตอร์ ใช้ร่วมกันทั้ง query นับจำนวนและ query ดึงข้อมูล
// ใช้ $1, $2 (parameterized query) เสมอ ไม่ต่อ string เข้า SQL ตรง ๆ เพื่อกัน SQL injection
function buildPostFilters({ category, keyword, status, authorId }) {
  const conditions = [];
  const values = [];

  // status = "all" คือไม่กรองสถานะเลย (admin ทั้งระบบ หรือเจ้าของดูของตัวเองด้วย mine=true)
  if (status !== "all") {
    values.push(status);
    conditions.push(`p.status = $${values.length}`);
  }

  // "Highlight" เป็นแค่แท็บ "ดูทั้งหมด" บนหน้าเว็บ ไม่ใช่หมวดหมู่จริง จึงไม่ต้องกรอง
  if (category && category !== "Highlight") {
    values.push(category);
    conditions.push(`c.name = $${values.length}`);
  }

  if (keyword) {
    values.push(`%${escapeLikePattern(keyword)}%`);
    const placeholder = `$${values.length}`;
    // ILIKE = LIKE แบบไม่สนตัวพิมพ์เล็ก/ใหญ่ ค้นทั้ง title และ description
    conditions.push(
      `(p.title ILIKE ${placeholder} ESCAPE '!' OR p.description ILIKE ${placeholder} ESCAPE '!')`
    );
  }

  // mine=true — ดูเฉพาะบทความที่ตัวเองเป็นเจ้าของ
  if (authorId) {
    values.push(authorId);
    conditions.push(`p.author_id = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, values };
}

async function getPostOwnership(id) {
  const result = await connectionPool.query(
    `SELECT id, author_id, status FROM posts WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

function canManagePost(user, authorId) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return authorId != null && Number(authorId) === Number(user.id);
}

function parsePostId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ดึงบทความตาม id (พร้อมชื่อหมวดหมู่) คืน null ถ้าไม่มี
// ใช้ร่วมกันทั้งใน GET /:id, POST และ PUT เพื่อให้รูปแบบ response เหมือนกันทุกที่
async function fetchPostById(id) {
  const result = await connectionPool.query(
    `SELECT ${POST_COLUMNS} ${POST_FROM} WHERE p.id = $1`,
    [id]
  );
  return result.rows.length > 0 ? toPost(result.rows[0]) : null;
}

// frontend ส่งหมวดหมู่มาเป็น "ชื่อ" (เช่น "Cat") แต่ตาราง posts เก็บเป็น category_id
// ฟังก์ชันนี้แปลงชื่อ -> id และยอมรับ category_id ที่ส่งมาเป็นตัวเลขตรง ๆ ด้วย
async function resolveCategoryId({ category, category_id }) {
  if (category_id !== undefined && category_id !== null) {
    const id = Number(category_id);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: "Invalid category_id" };
    }
    const found = await connectionPool.query(
      `SELECT id FROM categories WHERE id = $1`,
      [id]
    );
    if (found.rows.length === 0) {
      return { error: `Category id ${id} does not exist` };
    }
    return { id };
  }

  if (typeof category === "string" && category.trim() !== "") {
    const name = category.trim();
    const found = await connectionPool.query(
      `SELECT id FROM categories WHERE name = $1`,
      [name]
    );
    if (found.rows.length === 0) {
      return { error: `Category "${name}" does not exist` };
    }
    return { id: found.rows[0].id };
  }

  return { error: "Category is required" };
}

// ตรวจข้อมูลบทความก่อนบันทึก คืนข้อความ error ตัวแรกที่เจอ หรือ null ถ้าผ่านหมด
function validatePost({ title, description, content, author, status }) {
  if (typeof title !== "string" || title.trim() === "") {
    return "Title is required";
  }
  if (typeof description !== "string" || description.trim() === "") {
    return "Description is required";
  }
  if (typeof content !== "string" || content.trim() === "") {
    return "Content is required";
  }
  if (typeof author !== "string" || author.trim() === "") {
    return "Author is required";
  }
  if (status !== "published" && status !== "draft") {
    return `Status must be either "published" or "draft"`;
  }
  // ปล่อยให้ draft ยังเขียนไม่เสร็จได้ แต่ถ้าจะ publish ต้องมีหัวข้อตามรูปแบบ
  // ไม่งั้นบทความจะขึ้นหน้าเว็บแบบเนื้อหาว่างเปล่า
  if (status === "published" && !HEADING_PATTERN.test(content)) {
    return 'Content must contain headings in the format "## 1. Title" to be published';
  }
  return null;
}

// GET /posts?page=1&limit=6&category=Cat&keyword=xxx&status=all&mine=true
postRouter.get("/", attachUserIfPresent, async (req, res) => {
  // ถ้าไม่ส่งมาหรือส่งค่าเพี้ยน ให้ตกไปใช้ค่า default
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 6));
  const offset = (page - 1) * limit;

  const category =
    typeof req.query.category === "string" ? req.query.category.trim() : "";
  const keyword =
    typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";

  // mine=true = ขอเฉพาะบทความของตัวเอง (ต้อง login) ใช้ในหน้า My articles
  const mine = req.query.mine === "true";
  if (mine && !req.user) {
    return res.status(401).json({ message: "Authorization token is required" });
  }

  // ผู้เยี่ยมชมทั่วไปเห็นเฉพาะ published
  // admin ทั้งระบบ หรือเจ้าของที่ขอ mine=true ดู draft / all ได้
  const requestedStatus = req.query.status;
  const isAdmin = req.user?.role === "admin";
  const allowedStatuses = ["all", "draft", "published"];
  const canViewPrivateStatus = isAdmin || mine;
  const status =
    canViewPrivateStatus && allowedStatuses.includes(requestedStatus)
      ? requestedStatus
      : "published";

  const { where, values } = buildPostFilters({
    category,
    keyword,
    status,
    authorId: mine ? req.user.id : null,
  });

  try {
    // นับจำนวนทั้งหมดที่ตรงเงื่อนไข เพื่อคำนวณ totalPages
    const countResult = await connectionPool.query(
      `SELECT COUNT(*) AS total ${POST_FROM} ${where}`,
      values
    );
    // COUNT(*) เป็นชนิด bigint ซึ่ง pg คืนมาเป็น string ต้องแปลงเป็น number ก่อนส่งออก
    const totalPosts = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(totalPosts / limit);

    // ต่อ LIMIT/OFFSET ท้ายสุด โดยนับ placeholder ต่อจากที่ filter ใช้ไปแล้ว
    const result = await connectionPool.query(
      `SELECT ${POST_COLUMNS} ${POST_FROM} ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return res.status(200).json({
      posts: result.rows.map(toPost),
      currentPage: page,
      totalPages,
      totalPosts,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not fetch posts" });
  }
});

// GET /posts/:id — บทความเดียว
// published เปิดสาธารณะ / draft เห็นได้เฉพาะเจ้าของหรือ admin
postRouter.get("/:id", attachUserIfPresent, async (req, res) => {
  const id = parsePostId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  try {
    const ownership = await getPostOwnership(id);
    if (!ownership) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (
      ownership.status === "draft" &&
      !canManagePost(req.user, ownership.author_id)
    ) {
      return res.status(404).json({ message: "Post not found" });
    }

    const post = await fetchPostById(id);
    return res.status(200).json(post);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not fetch post" });
  }
});

// ---------------------------------------------------------------
// เขียนบทความ — login แล้วสร้างได้ / แก้-ลบได้เฉพาะของตัวเอง (หรือ admin)
// ---------------------------------------------------------------

// POST /posts — สร้างบทความใหม่ (user และ admin)
postRouter.post("/", protect, async (req, res) => {
  const { title, description, content, image } = req.body ?? {};
  const status = req.body?.status ?? "draft";
  // ชื่อผู้เขียนบังคับจากบัญชีที่ login อยู่ เพื่อไม่ให้แอบอ้างชื่อคนอื่น
  const author =
    typeof req.body?.author === "string" && req.body.author.trim() !== ""
      ? req.body.author.trim()
      : req.user.name;

  const invalid = validatePost({ title, description, content, author, status });
  if (invalid) {
    return res.status(400).json({ message: invalid });
  }

  try {
    const category = await resolveCategoryId(req.body ?? {});
    if (category.error) {
      return res.status(400).json({ message: category.error });
    }

    const inserted = await connectionPool.query(
      `INSERT INTO posts (title, description, content, category_id, author, author_id, image, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        title.trim(),
        description.trim(),
        content,
        category.id,
        author,
        req.user.id,
        typeof image === "string" && image.trim() !== "" ? image.trim() : null,
        status,
      ]
    );

    const post = await fetchPostById(inserted.rows[0].id);
    return res.status(201).json(post);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not create post" });
  }
});

// PUT /posts/:id — แก้ไขบทความของตัวเอง (admin แก้ได้ทุกบทความ)
postRouter.put("/:id", protect, async (req, res) => {
  const id = parsePostId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  const body = req.body ?? {};

  try {
    const ownership = await getPostOwnership(id);
    if (!ownership) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (!canManagePost(req.user, ownership.author_id)) {
      return res.status(403).json({ message: "You can only edit your own articles" });
    }

    const existing = await fetchPostById(id);
    const merged = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      content: body.content ?? existing.content,
      // user ทั่วไปห้ามเปลี่ยนชื่อผู้เขียน — admin เปลี่ยนได้ถ้าส่งมา
      author:
        req.user.role === "admin" && typeof body.author === "string"
          ? body.author
          : existing.author,
      status: body.status ?? existing.status,
      image: body.image !== undefined ? body.image : existing.image,
    };

    const invalid = validatePost(merged);
    if (invalid) {
      return res.status(400).json({ message: invalid });
    }

    const category = await resolveCategoryId(
      body.category !== undefined || body.category_id !== undefined
        ? body
        : { category: existing.category }
    );
    if (category.error) {
      return res.status(400).json({ message: category.error });
    }

    await connectionPool.query(
      `UPDATE posts SET
         title = $1, description = $2, content = $3,
         category_id = $4, author = $5, image = $6, status = $7
       WHERE id = $8`,
      [
        merged.title.trim(),
        merged.description.trim(),
        merged.content,
        category.id,
        merged.author.trim(),
        typeof merged.image === "string" && merged.image.trim() !== ""
          ? merged.image.trim()
          : null,
        merged.status,
        id,
      ]
    );

    const post = await fetchPostById(id);
    return res.status(200).json(post);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not update post" });
  }
});

// DELETE /posts/:id — ลบบทความของตัวเอง (admin ลบได้ทุกบทความ)
postRouter.delete("/:id", protect, async (req, res) => {
  const id = parsePostId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  try {
    const ownership = await getPostOwnership(id);
    if (!ownership) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (!canManagePost(req.user, ownership.author_id)) {
      return res.status(403).json({ message: "You can only delete your own articles" });
    }

    await connectionPool.query(`DELETE FROM posts WHERE id = $1`, [id]);

    return res.status(200).json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not delete post" });
  }
});

export default postRouter;
