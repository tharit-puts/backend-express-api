import "dotenv/config";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

if (!JWT_SECRET) {
  throw new Error("ไม่พบ JWT_SECRET — กรุณาใส่ค่าในไฟล์ .env");
}

// สร้าง token จากข้อมูลผู้ใช้
// ใส่แค่ข้อมูลที่จำเป็น เพราะ payload ของ JWT ใครก็อ่านได้ (แค่ปลอมแปลงไม่ได้)
// ห้ามใส่รหัสผ่านหรือ hash ลงไปเด็ดขาด
export function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// ตรวจลายเซ็นและวันหมดอายุ ถ้าไม่ผ่านจะ throw
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
