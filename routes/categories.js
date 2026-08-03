import { Router } from "express";
import { connectionPool } from "../utils/db.js";
import { protectAdmin } from "../middlewares/protect.js";

const categoryRouter = Router();

// แปลง :id จาก string เป็นตัวเลข ถ้าไม่ใช่ตัวเลขคืน null
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ตรวจว่า name ที่ส่งมาใช้ได้ไหม ถ้าใช้ได้คืนค่าที่ตัดช่องว่างแล้ว
function parseName(body) {
  if (typeof body?.name !== "string" || body.name.trim() === "") {
    return null;
  }
  return body.name.trim();
}

// GET /categories — เอาหมวดหมู่ทั้งหมด
categoryRouter.get("/", async (req, res) => {
  try {
    const result = await connectionPool.query(
      `SELECT id, name FROM categories ORDER BY name ASC`
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not fetch categories" });
  }
});

// GET /categories/:id — เอาหมวดหมู่เดียว
categoryRouter.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid category id" });
  }

  try {
    const result = await connectionPool.query(
      `SELECT id, name FROM categories WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not fetch category" });
  }
});

// การอ่านเปิดให้ทุกคน แต่การเพิ่ม/แก้/ลบ ต้องเป็น admin เหมือนกับ /posts
// POST /categories — สร้างหมวดหมู่ใหม่
categoryRouter.post("/", protectAdmin, async (req, res) => {
  const name = parseName(req.body);
  if (!name) {
    return res.status(400).json({ message: "Category name is required" });
  }

  try {
    const result = await connectionPool.query(
      `INSERT INTO categories (name) VALUES ($1) RETURNING id, name`,
      [name]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    // 23505 = unique_violation (ชื่อหมวดหมู่ซ้ำ เพราะเราตั้ง UNIQUE ไว้)
    if (error.code === "23505") {
      return res.status(409).json({ message: "Category name already exists" });
    }
    console.error(error);
    return res.status(500).json({ message: "Could not create category" });
  }
});

// PUT /categories/:id — แก้ชื่อหมวดหมู่
categoryRouter.put("/:id", protectAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid category id" });
  }

  const name = parseName(req.body);
  if (!name) {
    return res.status(400).json({ message: "Category name is required" });
  }

  try {
    const result = await connectionPool.query(
      `UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name`,
      [name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Category name already exists" });
    }
    console.error(error);
    return res.status(500).json({ message: "Could not update category" });
  }
});

// DELETE /categories/:id — ลบหมวดหมู่
categoryRouter.delete("/:id", protectAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid category id" });
  }

  try {
    const result = await connectionPool.query(
      `DELETE FROM categories WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }

    return res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    // 23503 = foreign_key_violation (ยังมีบทความใช้หมวดหมู่นี้อยู่)
    if (error.code === "23503") {
      return res
        .status(409)
        .json({ message: "Cannot delete a category that still has posts" });
    }
    console.error(error);
    return res.status(500).json({ message: "Could not delete category" });
  }
});

export default categoryRouter;
