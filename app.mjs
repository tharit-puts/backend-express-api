import "dotenv/config";
import express from "express";
import cors from "cors";

import authRouter from "./routes/auth.js";
import categoryRouter from "./routes/categories.js";
import postRouter from "./routes/posts.js";

const app = express();
const PORT = process.env.PORT || 4000;

// อ่าน JSON body ที่ client ส่งมา แล้วเอาไปใส่ไว้ใน req.body
// ขยาย limit จากค่า default 100kb เพราะหน้า admin อัปโหลดรูปมาเป็น base64 data URL
// ซึ่งใหญ่กว่า 100kb ได้ง่าย ๆ ถ้าไม่ขยายจะโดนปฏิเสธด้วย error 413
app.use(express.json({ limit: "5mb" }));

// อนุญาตให้เฉพาะ frontend 2 ตัวนี้เรียก API ข้ามโดเมนได้
// หมายเหตุ: origin ต้องไม่มี / ปิดท้าย ไม่งั้นเบราว์เซอร์จะเทียบไม่ตรงและถูกบล็อก
app.use(
  cors({
    origin: ["http://localhost:5173", "https://tharit-puts-project.vercel.app"],
  })
);

app.get("/health", (req, res) => {
  return res.status(200).json({ message: "OK" });
});

// ทุก path ที่ขึ้นต้นด้วย /auth ส่งต่อให้ authRouter จัดการ (ที่อื่นก็หลักการเดียวกัน)
app.use("/auth", authRouter);
app.use("/categories", categoryRouter);
app.use("/posts", postRouter);

// ถ้าไม่ตรง route ไหนเลย ตอบ 404 ในรูปแบบเดียวกับ error อื่น ๆ
app.use((req, res) => {
  return res.status(404).json({ message: `Not found: ${req.method} ${req.path}` });
});

// Error handler กลาง: ต้องมี 4 พารามิเตอร์ Express จึงจะรู้ว่านี่คือ error handler
app.use((error, req, res, next) => {
  // ถ้า client ส่ง JSON ที่รูปแบบผิด express.json() จะโยน error ตัวนี้มา
  // ความผิดอยู่ที่ฝั่งผู้ส่ง จึงต้องเป็น 400 ไม่ใช่ 500
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON in request body" });
  }

  // body ใหญ่เกิน limit ที่ตั้งไว้
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large" });
  }

  console.error(error);
  return res.status(500).json({ message: "Internal server error" });
});

// บน Vercel ไม่ต้อง (และไม่ควร) เปิด port เอง เพราะ Vercel เป็นคนเรียก app ให้
// เวลารันบนเครื่องเราถึงจะ listen จริง
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

// Vercel ต้องการ default export เพื่อเอา app ไปใช้เป็น serverless function
export default app;
