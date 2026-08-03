import { verifyToken } from "../utils/jwt.js";

/**
 * protect — ยามเฝ้าประตู ใช้กับ route ที่ต้อง login ก่อน
 *
 * client ต้องส่ง header มาแบบนี้:  Authorization: Bearer <token>
 * ถ้าผ่าน จะแปะข้อมูลผู้ใช้ไว้ที่ req.user ให้ route ถัดไปใช้ต่อ
 */
export function protect(req, res, next) {
  const authHeader = req.headers.authorization ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token is required" });
  }

  // ตัดคำว่า "Bearer " (7 ตัวอักษร) ออก เหลือแค่ token
  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({ message: "Authorization token is required" });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token has expired, please log in again" });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
}

/**
 * protectAdmin — ต้อง login และต้องมี role = admin
 *
 * 401 = ยังไม่ได้บอกว่าเป็นใคร (ไม่มี token / token ใช้ไม่ได้)
 * 403 = รู้ว่าเป็นใครแล้ว แต่สิทธิ์ไม่ถึง
 */
export function protectAdmin(req, res, next) {
  return protect(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Admin access is required" });
    }
    return next();
  });
}

/**
 * attachUserIfPresent — "ยามใจดี" ไม่บล็อกใครเลย
 *
 * ถ้ามี token ที่ใช้ได้ จะแปะ req.user ให้ ถ้าไม่มีหรือใช้ไม่ได้ก็ปล่อยผ่านโดย req.user = undefined
 * ใช้กับ route ที่เปิดให้ทุกคนเข้าได้ แต่อยากแสดงข้อมูลเพิ่มถ้าคนที่เข้ามาเป็น admin
 * (เช่น GET /posts ที่ admin ขอดูบทความ draft ได้)
 */
export function attachUserIfPresent(req, res, next) {
  const authHeader = req.headers.authorization ?? "";

  if (authHeader.startsWith("Bearer ")) {
    try {
      req.user = verifyToken(authHeader.slice(7).trim());
    } catch {
      // token ใช้ไม่ได้ก็ถือว่าเป็นผู้เยี่ยมชมทั่วไป ไม่ต้องแจ้ง error
    }
  }

  return next();
}
