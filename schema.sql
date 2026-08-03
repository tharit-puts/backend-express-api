-- ============================================================
-- Personal Blog — โครงสร้างตาราง (รันไฟล์นี้ใน Supabase SQL Editor)
-- รันซ้ำได้ปลอดภัย เพราะใช้ IF NOT EXISTS ทุกที่
-- ============================================================

-- ------------------------------------------------------------
-- categories: หมวดหมู่ของบทความ
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

-- ------------------------------------------------------------
-- users: ผู้ใช้ (เก็บเฉพาะ hash ของรหัสผ่าน ไม่เก็บรหัสผ่านจริง)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  avatar        TEXT,
  bio           TEXT,
  role          VARCHAR(20)  NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
);

-- เผื่อกรณีที่สร้างตาราง users ไว้ก่อนที่จะมีคอลัมน์ bio
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

-- ------------------------------------------------------------
-- posts: บทความ
-- category_id ชี้ไปที่ categories.id (FK)
-- ON DELETE RESTRICT = ห้ามลบหมวดหมู่ที่ยังมีบทความอยู่
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description VARCHAR(500) NOT NULL,
  content     TEXT         NOT NULL,
  category_id INTEGER      NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  author      VARCHAR(255) NOT NULL,
  image       TEXT,
  likes       INTEGER      NOT NULL DEFAULT 0,
  status      VARCHAR(20)  NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT posts_status_check CHECK (status IN ('published', 'draft'))
);

-- ------------------------------------------------------------
-- Index ช่วยให้ query ที่ใช้บ่อยเร็วขึ้น
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS posts_category_id_idx ON posts (category_id);
CREATE INDEX IF NOT EXISTS posts_status_idx      ON posts (status);
CREATE INDEX IF NOT EXISTS posts_created_at_idx  ON posts (created_at DESC);

-- ------------------------------------------------------------
-- ใส่หมวดหมู่เริ่มต้น (ต้องตรงกับที่ frontend ใช้)
-- ON CONFLICT DO NOTHING = ถ้ามีชื่อนี้อยู่แล้วให้ข้ามไป ไม่ error
-- หมายเหตุ: "Highlight" ไม่ใช่หมวดหมู่จริง เป็นแค่แท็บ "ดูทั้งหมด" บนหน้าเว็บ
-- ------------------------------------------------------------
INSERT INTO categories (name)
VALUES ('Cat'), ('General'), ('Inspiration')
ON CONFLICT (name) DO NOTHING;
