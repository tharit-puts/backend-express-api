# Personal Blog — Backend API

REST API สำหรับเว็บบล็อกส่วนตัว เขียนด้วย Express 5 + PostgreSQL (SQL ดิบ ไม่ใช้ ORM)

## Stack

| ส่วน | เทคโนโลยี |
|---|---|
| Runtime | Node.js (ESM — `"type": "module"`) |
| Web framework | Express 5 |
| Database | PostgreSQL บน Supabase |
| Database driver | `pg` (เขียน SQL เอง ไม่ใช้ ORM) |
| Auth | `bcrypt` + `jsonwebtoken` (เขียนเอง ไม่ใช้ Supabase Auth) |
| อื่น ๆ | `cors`, `dotenv`, `nodemon` |

## โครงสร้างไฟล์

```
app.mjs                  จุดเริ่มต้น: ตั้งค่า middleware, ต่อ router, error handler
schema.sql               คำสั่งสร้างตาราง (รันใน Supabase SQL Editor)
seed.js                  ดึงบทความตัวอย่าง 30 อันมาใส่ database
utils/
  db.js                  connectionPool ของ pg (เปิด SSL สำหรับ Supabase)
  jwt.js                 สร้าง/ตรวจสอบ JWT
middlewares/
  protect.js             protect (ต้อง login) และ protectAdmin (ต้องเป็น admin)
routes/
  auth.js                สมัคร, เข้าสู่ระบบ, โปรไฟล์, เปลี่ยนรหัสผ่าน
  posts.js               บทความ (อ่านได้ทุกคน / เขียนได้เฉพาะ admin)
  categories.js          หมวดหมู่ (อ่านได้ทุกคน / เขียนได้เฉพาะ admin)
```

## เริ่มใช้งาน

```bash
npm install
```

สร้างไฟล์ `.env` (ดูตัวอย่างที่ `.env.example`):

```
DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
JWT_SECRET=<ค่าสุ่มยาว ๆ>
JWT_EXPIRES_IN=7d
PORT=4000
```

> ใช้ connection string แบบ **Transaction pooler** (port `6543`) ของ Supabase
> เพราะ direct connection เป็น IPv6 ซึ่งเน็ตบ้านส่วนใหญ่ต่อไม่ได้

สร้างตารางโดยเอาเนื้อหาใน `schema.sql` ไปรันใน Supabase SQL Editor แล้ว:

```bash
npm run seed    # ใส่บทความตัวอย่าง 30 อัน (รันซ้ำได้ ไม่เกิดข้อมูลซ้ำ)
npm run dev     # รันแบบ auto-reload ที่ http://localhost:4000
npm start       # รันแบบธรรมดา
```

## สร้าง admin คนแรก

สมัครสมาชิกผ่าน `POST /auth/register` ตามปกติ (ทุกคนจะได้ `role = 'user'`)
แล้วเลื่อนขั้นเป็น admin ด้วย SQL ใน Supabase SQL Editor:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

> `role` ถูกฝังอยู่ใน token ดังนั้นหลังเปลี่ยน role ต้อง **login ใหม่** เพื่อรับ token ใบใหม่

## API

ทุก error ตอบกลับในรูปแบบ `{ "message": "..." }`

### Health

| Method | Path | สิทธิ์ | ผลลัพธ์ |
|---|---|---|---|
| GET | `/health` | ทุกคน | `{ "message": "OK" }` |

### Posts

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/posts` | ทุกคน (หรือ login แล้วใช้ `mine=true`) |
| GET | `/posts/:id` | published = ทุกคน / draft = เจ้าของหรือ admin |
| POST | `/posts` | ต้อง login (user หรือ admin) |
| PUT | `/posts/:id` | เจ้าของบทความ หรือ admin |
| DELETE | `/posts/:id` | เจ้าของบทความ หรือ admin |

`GET /posts?mine=true&status=all` — ดึงเฉพาะบทความของตัวเอง รวม draft (ใช้หน้า My articles)

**`GET /posts`** — query parameter ทุกตัวใส่หรือไม่ใส่ก็ได้

| Parameter | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `page` | `1` | หน้าที่ต้องการ |
| `limit` | `6` | จำนวนต่อหน้า (สูงสุด 100) |
| `category` | — | กรองตามชื่อหมวดหมู่ — `Highlight` = ไม่กรอง เอาทั้งหมด |
| `keyword` | — | ค้นใน `title` และ `description` แบบไม่สนตัวพิมพ์เล็กใหญ่ |

แสดงเฉพาะบทความที่ `status = 'published'`

```json
{
  "posts": [
    {
      "id": 1,
      "title": "The Art of Mindfulness",
      "description": "บทนำสั้น ๆ ที่หน้าเว็บใช้เป็นย่อหน้าแรก",
      "content": "## 1. หัวข้อแรก\n\nย่อหน้า...\n\n## 2. หัวข้อสอง\n\nย่อหน้า...",
      "category": "General",
      "author": "Thompson P.",
      "image": "https://...",
      "date": "2024-09-11T00:00:00.000Z",
      "likes": 321,
      "status": "published"
    }
  ],
  "currentPage": 1,
  "totalPages": 5,
  "totalPosts": 30
}
```

`GET /posts/:id` คืน object บทความเดียว (ไม่ห่อใน `posts`) และคืนบทความที่เป็น `draft` ด้วย
เพื่อให้หน้าแก้ไขของ admin เปิดร่างขึ้นมาแก้ได้

**body ของ POST / PUT `/posts`**

```json
{
  "title": "หัวข้อบทความ",
  "description": "บทนำสั้น ๆ",
  "content": "## 1. หัวข้อแรก\n\nย่อหน้า...",
  "category": "Cat",
  "author": "ชื่อผู้เขียน",
  "image": "https://... (ใส่ null ได้)",
  "status": "published"
}
```

- `category` ส่งมาเป็น **ชื่อ** (string) แล้ว backend หา `category_id` ให้เอง
  (หรือส่ง `category_id` เป็นตัวเลขมาตรง ๆ ก็ได้)
- `status` ถ้าไม่ส่งจะเป็น `draft`
- `PUT` ส่งมาแค่ช่องที่อยากแก้ก็ได้ ช่องที่ไม่ส่งจะคงค่าเดิม

### Notifications

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/notifications` | ต้อง login |
| GET | `/notifications/unread-count` | ต้อง login |
| PATCH | `/notifications/read` | ต้อง login |

เมื่อมีคน comment บทความ ระบบจะสร้างแจ้งเตือนให้:
- เจ้าของบทความ (`posts.author_id`) ถ้ามี
- หรือ admin ทุกคน ถ้าเป็นบทความ seed ที่ยังไม่มีเจ้าของ
- ไม่แจ้งตัวเอง

ถ้ายังไม่มีตาราง ให้รัน `node migrate-notifications.js`

### Comments

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/posts/:postId/comments` | ทุกคน |
| POST | `/posts/:postId/comments` | ต้อง login |

```json
// GET คืน array, POST คืน object เดียว
{
  "id": 1,
  "postId": 25,
  "userId": 3,
  "name": "Emma R.",
  "text": "Love this post!",
  "date": "2024-09-15T19:12:00.000Z",
  "avatar": null
}
```

**body ของ POST**

```json
{ "content": "What are your thoughts?" }
```

ถ้ายังไม่มีตาราง `comments` ใน database ให้รัน `node migrate-comments.js` ครั้งเดียว

### Categories

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/categories` | ทุกคน |
| GET | `/categories/:id` | ทุกคน |
| POST | `/categories` | admin |
| PUT | `/categories/:id` | admin |
| DELETE | `/categories/:id` | admin |

รูปแบบ object: `{ "id": 1, "name": "Cat" }` — body ของ POST/PUT: `{ "name": "..." }`

ลบหมวดหมู่ที่ยังมีบทความอยู่ไม่ได้ (ตอบ `409`) เพราะ foreign key ป้องกันไว้

### Auth

| Method | Path | สิทธิ์ | body |
|---|---|---|---|
| POST | `/auth/register` | ทุกคน | `{ name, username, email, password }` |
| POST | `/auth/login` | ทุกคน | `{ email, password }` |
| GET | `/auth/me` | ต้อง login | — |
| PUT | `/auth/profile` | ต้อง login | `{ name?, username?, avatar? }` |
| PUT | `/auth/reset-password` | ต้อง login | `{ currentPassword, newPassword }` |

- `register` และ `login` คืน `{ token, user }` — ที่เหลือคืน object ของ `user` หรือ `{ message }`
- ช่อง `email` ตอน login **รับได้ทั้งอีเมลและ username** (หน้าเว็บส่งค่าที่ผู้ใช้พิมพ์มาในชื่อ `email` เสมอ)
- รหัสผ่านอย่างน้อย 6 ตัวอักษร
- `user` ที่ส่งออกไม่มี `password_hash` เด็ดขาด

ส่ง token ไปกับ request ที่ต้อง login แบบนี้:

```
Authorization: Bearer <token>
```

### สรุป status code

| Code | ใช้เมื่อ |
|---|---|
| `200` | สำเร็จ |
| `201` | สร้างข้อมูลใหม่สำเร็จ |
| `400` | ข้อมูลที่ส่งมาไม่ถูกต้อง / JSON เสีย |
| `401` | ยังไม่ได้ login, token ใช้ไม่ได้/หมดอายุ, login ผิด, รหัสผ่านเดิมผิด |
| `403` | login แล้วแต่สิทธิ์ไม่ถึง (ไม่ใช่ admin) |
| `404` | ไม่พบข้อมูล / ไม่มี route นี้ |
| `409` | ข้อมูลชนกัน (email/username/ชื่อหมวดหมู่ซ้ำ, ลบหมวดหมู่ที่มีบทความ) |
| `413` | body ใหญ่เกินไป (จำกัดไว้ 5mb) |
| `500` | ข้อผิดพลาดฝั่ง server |

## รูปแบบของ `content` (สำคัญ)

หน้าเว็บแบ่งเนื้อหาเป็นหัวข้อด้วย `content.split(/## \d+\.\s/)` ดังนั้น `content` **ต้อง**
ขึ้นหัวข้อด้วย `## 1. `, `## 2. ` (มีช่องว่างหลังจุด) และคั่นย่อหน้าด้วยบรรทัดว่าง:

```
## 1. ชื่อหัวข้อแรก

ย่อหน้าแรก

ย่อหน้าที่สอง

## 2. ชื่อหัวข้อที่สอง

ย่อหน้า
```

ข้อควรรู้เพิ่มเติม:

- ข้อความที่อยู่**ก่อน** `## 1. ` จะถูกทิ้ง — บทนำของหน้าบทความมาจากช่อง `description`
- บรรทัดแรกของแต่ละบล็อกคือชื่อหัวข้อ ส่วนที่เหลือคั่นด้วยบรรทัดว่างกลายเป็นย่อหน้า
- backend บังคับกฎนี้ให้: ถ้าจะบันทึกเป็น `status = 'published'` แต่ `content` ไม่มีหัวข้อ
  รูปแบบนี้เลย จะตอบ `400` ส่วน `draft` ยอมให้เขียนไม่เสร็จได้

## CORS

อนุญาต 2 origin นี้ (แก้ได้ที่ `app.mjs`):

- `http://localhost:5173`
- `https://tharit-puts-project.vercel.app`

> origin ต้อง **ไม่มี** `/` ปิดท้าย ไม่งั้นเบราว์เซอร์จะเทียบไม่ตรงและบล็อก request

## Deploy บน Vercel

`vercel.json` ตั้งค่าไว้แล้ว `app.mjs` ทำ `export default app` และจะข้ามการ `listen`
เมื่อเจอ environment variable `VERCEL` อย่าลืมไปใส่ `DATABASE_URL` กับ `JWT_SECRET`
ใน Vercel Project Settings → Environment Variables ด้วย
