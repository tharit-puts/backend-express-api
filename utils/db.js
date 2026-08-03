import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "ไม่พบ DATABASE_URL — กรุณาสร้างไฟล์ .env และใส่ connection string ของ Supabase"
  );
}

// Supabase บังคับให้เชื่อมต่อผ่าน SSL
// rejectUnauthorized: false = ไม่ต้องตรวจใบรับรอง CA (จำเป็นเวลาต่อ Supabase จากเครื่องเรา)
// ถ้าเป็น Postgres ที่ลงในเครื่องเอง (localhost) ไม่ต้องใช้ SSL
const isLocal =
  connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

export const connectionPool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
