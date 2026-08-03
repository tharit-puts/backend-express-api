import { Router } from "express";
import bcrypt from "bcrypt";

import { connectionPool } from "../utils/db.js";
import { createToken } from "../utils/jwt.js";
import { protect } from "../middlewares/protect.js";

const authRouter = Router();

// ยิ่งเลขสูงยิ่งแฮชช้าและเดายากขึ้น 10 เป็นค่ามาตรฐานที่สมดุลระหว่างความปลอดภัยกับความเร็ว
const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 6;

// คอลัมน์ที่ปลอดภัยจะส่งออกไปให้ client — ไม่มี password_hash อยู่ในนี้เด็ดขาด
const USER_COLUMNS = `id, name, username, email, avatar, bio, role, created_at`;

function toUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    bio: row.bio,
    role: row.role,
    created_at: row.created_at.toISOString(),
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// POST /auth/register — สมัครสมาชิก
authRouter.post("/register", async (req, res) => {
  const { name, username, email, password } = req.body ?? {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ message: "Name is required" });
  }
  if (!isNonEmptyString(username)) {
    return res.status(400).json({ message: "Username is required" });
  }
  if (!isNonEmptyString(email) || !isValidEmail(email.trim())) {
    return res.status(400).json({ message: "A valid email is required" });
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  // เก็บ email เป็นตัวพิมพ์เล็กทั้งหมด เพื่อไม่ให้ A@b.com กับ a@b.com เป็นคนละคน
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim();

  try {
    // เก็บแค่ hash ไม่เก็บรหัสผ่านจริง ถ้า database รั่วก็ย้อนกลับเป็นรหัสผ่านไม่ได้
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await connectionPool.query(
      `INSERT INTO users (name, username, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING ${USER_COLUMNS}`,
      [name.trim(), normalizedUsername, normalizedEmail, passwordHash]
    );

    const user = toUser(result.rows[0]);
    return res.status(201).json({ token: createToken(user), user });
  } catch (error) {
    // 23505 = unique_violation — ดูจากชื่อ constraint ว่าซ้ำที่ email หรือ username
    if (error.code === "23505") {
      const field = error.constraint === "users_username_key" ? "Username" : "Email";
      return res.status(409).json({ message: `${field} is already taken` });
    }
    console.error(error);
    return res.status(500).json({ message: "Could not register user" });
  }
});

// POST /auth/login — เข้าสู่ระบบ
// ช่อง email รับได้ทั้งอีเมลและ username (frontend ส่งค่าที่ผู้ใช้พิมพ์มาในชื่อ email เสมอ)
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!isNonEmptyString(email) || typeof password !== "string" || password === "") {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const identifier = email.trim();

  try {
    const result = await connectionPool.query(
      `SELECT ${USER_COLUMNS}, password_hash
       FROM users
       WHERE email = $1 OR username = $2
       LIMIT 1`,
      [identifier.toLowerCase(), identifier]
    );

    const row = result.rows[0];

    // ถ้าไม่เจอผู้ใช้ ยังต้องเรียก bcrypt.compare กับ hash ปลอม
    // เพื่อให้เวลาตอบกลับใกล้เคียงกับกรณีรหัสผ่านผิด คนภายนอกจะเดาไม่ได้ว่าอีเมลนี้มีอยู่จริงไหม
    const hashToCompare =
      row?.password_hash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    const isMatch = await bcrypt.compare(password, hashToCompare);

    // ข้อความเดียวกันทั้งกรณีไม่มีผู้ใช้และรหัสผ่านผิด เพื่อไม่บอกใบ้ผู้ไม่ประสงค์ดี
    if (!row || !isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = toUser(row);
    return res.status(200).json({ token: createToken(user), user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not log in" });
  }
});

// GET /auth/me — ข้อมูลผู้ใช้ที่ login อยู่
// อ่านสด ๆ จาก database ไม่ใช้ข้อมูลใน token เพราะ token อาจถูกสร้างไว้นานแล้วและข้อมูลเปลี่ยนไปแล้ว
authRouter.get("/me", protect, async (req, res) => {
  try {
    const result = await connectionPool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(toUser(result.rows[0]));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not fetch user profile" });
  }
});

// PUT /auth/profile — แก้ไขโปรไฟล์ (แก้เฉพาะช่องที่ส่งมา)
authRouter.put("/profile", protect, async (req, res) => {
  const { name, username, avatar, bio } = req.body ?? {};

  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ message: "Name cannot be empty" });
  }
  if (username !== undefined && !isNonEmptyString(username)) {
    return res.status(400).json({ message: "Username cannot be empty" });
  }
  if (avatar !== undefined && avatar !== null && typeof avatar !== "string") {
    return res.status(400).json({ message: "Avatar must be a string or null" });
  }
  if (bio !== undefined && bio !== null && typeof bio !== "string") {
    return res.status(400).json({ message: "Bio must be a string or null" });
  }

  if (
    name === undefined &&
    username === undefined &&
    avatar === undefined &&
    bio === undefined
  ) {
    return res.status(400).json({ message: "No fields to update" });
  }

  try {
    // COALESCE($1, name) = ถ้าส่ง null มาให้ใช้ค่าเดิม ใช้กับช่องที่ห้ามว่าง
    // ส่วน avatar/bio อนุญาตให้ตั้งเป็น null ได้ จึงต้องใช้ CASE WHEN แยกระหว่าง
    // "ไม่ได้ส่งมา" (คงค่าเดิม) กับ "ส่ง null มา" (ล้างค่า)
    const result = await connectionPool.query(
      `UPDATE users SET
         name     = COALESCE($1, name),
         username = COALESCE($2, username),
         avatar   = CASE WHEN $3::boolean THEN $4 ELSE avatar END,
         bio      = CASE WHEN $5::boolean THEN $6 ELSE bio END
       WHERE id = $7
       RETURNING ${USER_COLUMNS}`,
      [
        name === undefined ? null : name.trim(),
        username === undefined ? null : username.trim(),
        avatar !== undefined,
        avatar ?? null,
        bio !== undefined,
        bio ?? null,
        req.user.id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(toUser(result.rows[0]));
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Username is already taken" });
    }
    console.error(error);
    return res.status(500).json({ message: "Could not update profile" });
  }
});

// PUT /auth/reset-password — เปลี่ยนรหัสผ่าน (ต้องยืนยันรหัสผ่านเดิมก่อน)
authRouter.put("/reset-password", protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (typeof currentPassword !== "string" || currentPassword === "") {
    return res.status(400).json({ message: "Current password is required" });
  }
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }
  if (currentPassword === newPassword) {
    return res
      .status(400)
      .json({ message: "New password must be different from the current password" });
  }

  try {
    const result = await connectionPool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await connectionPool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newHash, req.user.id]
    );

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not update password" });
  }
});

export default authRouter;
