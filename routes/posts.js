import { Router } from "express";
import { connectionPool } from "../utils/db.js";
import { attachUserIfPresent, protectAdmin } from "../middlewares/protect.js";

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
  p.image,
  p.likes,
  p.status,
  p.created_at
`;

const POST_FROM = `
  FROM posts p
  INNER JOIN categories c ON c.id = p.category_id
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
function buildPostFilters({ category, keyword, status }) {
  const conditions = [];
  const values = [];

  // status = "all" คือไม่กรองสถานะเลย (เฉพาะ admin ที่ขอมาแบบนั้นได้)
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, values };
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

// GET /posts?page=1&limit=6&category=Cat&keyword=xxx&status=all
postRouter.get("/", attachUserIfPresent, async (req, res) => {
  // ถ้าไม่ส่งมาหรือส่งค่าเพี้ยน ให้ตกไปใช้ค่า default
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 6));
  const offset = (page - 1) * limit;

  const category =
    typeof req.query.category === "string" ? req.query.category.trim() : "";
  const keyword =
    typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";

  // ผู้เยี่ยมชมทั่วไปเห็นเฉพาะ published เท่านั้น
  // เฉพาะ admin ที่ระบุ status มาเองจึงจะดู draft หรือดูทั้งหมดได้ (หน้า Article management ต้องใช้)
  const requestedStatus = req.query.status;
  const isAdmin = req.user?.role === "admin";
  const allowedStatuses = ["all", "draft", "published"];
  const status =
    isAdmin && allowedStatuses.includes(requestedStatus)
      ? requestedStatus
      : "published";

  const { where, values } = buildPostFilters({ category, keyword, status });

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

// GET /posts/:id — บทความเดียว (คืนทั้ง published และ draft เพื่อให้หน้าแก้ไขของ admin ใช้ได้)
postRouter.get("/:id", async (req, res) => {
  const id = parsePostId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  try {
    const post = await fetchPostById(id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    return res.status(200).json(post);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not fetch post" });
  }
});

// ---------------------------------------------------------------
// ตั้งแต่นี้ลงไปต้อง login เป็น admin (ใส่ protectAdmin เป็นตัวที่ 2)
// ---------------------------------------------------------------

// POST /posts — สร้างบทความใหม่
postRouter.post("/", protectAdmin, async (req, res) => {
  const { title, description, content, author, image } = req.body ?? {};
  const status = req.body?.status ?? "draft";

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
      `INSERT INTO posts (title, description, content, category_id, author, image, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        title.trim(),
        description.trim(),
        content,
        category.id,
        author.trim(),
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

// PUT /posts/:id — แก้ไขบทความ (ส่งมาแค่ช่องที่อยากแก้ก็ได้)
postRouter.put("/:id", protectAdmin, async (req, res) => {
  const id = parsePostId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  const body = req.body ?? {};

  try {
    // อ่านของเดิมมาก่อน แล้วเอาค่าใหม่ทับเฉพาะช่องที่ส่งมา
    // ทำแบบนี้เพื่อให้ตรวจความถูกต้องของ "ผลลัพธ์สุดท้าย" ได้
    // เช่น ถ้าเปลี่ยนสถานะเป็น published ต้องเช็ค content เดิมว่ามีหัวข้อครบไหม
    const existing = await fetchPostById(id);
    if (!existing) {
      return res.status(404).json({ message: "Post not found" });
    }

    const merged = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      content: body.content ?? existing.content,
      author: body.author ?? existing.author,
      status: body.status ?? existing.status,
      image: body.image !== undefined ? body.image : existing.image,
    };

    const invalid = validatePost(merged);
    if (invalid) {
      return res.status(400).json({ message: invalid });
    }

    // ถ้าไม่ได้ส่งหมวดหมู่มา ให้ใช้ของเดิม (existing.category เป็นชื่อหมวดหมู่)
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

// DELETE /posts/:id — ลบบทความ
postRouter.delete("/:id", protectAdmin, async (req, res) => {
  const id = parsePostId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid post id" });
  }

  try {
    const result = await connectionPool.query(
      `DELETE FROM posts WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Post not found" });
    }

    return res.status(200).json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not delete post" });
  }
});

export default postRouter;
