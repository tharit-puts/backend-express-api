/**
 * seed.js — ดึงบทความจาก API ตัวอย่างมาใส่ database ของเรา
 *
 * วิธีรัน:  npm run seed
 *
 * รันซ้ำได้ปลอดภัย เพราะใช้ ON CONFLICT (id) DO UPDATE (upsert)
 * บทความเดิมจะถูกอัปเดตทับ ไม่เกิดข้อมูลซ้ำ
 */
import { connectionPool } from "./utils/db.js";

const SOURCE_API = "https://blog-post-project-api.vercel.app/posts";
const PAGE_LIMIT = 30;
const MAX_PAGES = 15;

// frontend แบ่งหัวข้อด้วย regex ตัวนี้ ถ้า content ไม่ตรง เนื้อหาจะไม่ถูกแบ่งหัวข้อ
const HEADING_PATTERN = /## \d+\.\s/;

async function fetchAllPosts() {
  const postsById = new Map();
  let totalPages = 1;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${SOURCE_API}?page=${page}&limit=${PAGE_LIMIT}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`ดึงข้อมูลหน้า ${page} ไม่สำเร็จ (HTTP ${response.status})`);
    }

    const data = await response.json();
    // ใช้ Map คีย์เป็น id เพื่อกันบทความซ้ำถ้า API แบ่งหน้าเหลื่อมกัน
    for (const post of data.posts ?? []) {
      postsById.set(post.id, post);
    }

    totalPages = data.totalPages ?? 1;
    console.log(
      `  หน้า ${page}/${totalPages} — ได้ ${data.posts?.length ?? 0} บทความ (รวมสะสม ${postsById.size})`
    );

    if (page >= totalPages) break;
  }

  return [...postsById.values()];
}

// ทำให้แน่ใจว่าทุกหมวดหมู่ที่ API ใช้มีอยู่ในตาราง categories แล้วคืน map ชื่อ -> id
async function ensureCategories(client, posts) {
  const names = [...new Set(posts.map((p) => p.category).filter(Boolean))];

  for (const name of names) {
    await client.query(
      `INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }

  const result = await client.query(`SELECT id, name FROM categories`);
  return new Map(result.rows.map((row) => [row.name, row.id]));
}

async function main() {
  console.log("1) ดึงบทความจาก API ต้นทาง...");
  const posts = await fetchAllPosts();
  console.log(`   ได้ทั้งหมด ${posts.length} บทความ\n`);

  if (posts.length === 0) {
    throw new Error("ไม่ได้บทความเลย — ยกเลิกการ seed");
  }

  // เตือนถ้า content ไม่ตรงรูปแบบที่ frontend ต้องการ
  const badFormat = posts.filter((p) => !HEADING_PATTERN.test(p.content ?? ""));
  if (badFormat.length > 0) {
    console.log(
      `   ⚠️  ${badFormat.length} บทความ content ไม่มีหัวข้อรูปแบบ "## 1. " — frontend จะแบ่งหัวข้อไม่ได้`
    );
    console.log(`      id ที่มีปัญหา: ${badFormat.map((p) => p.id).join(", ")}\n`);
  } else {
    console.log(`   ✅ ทุกบทความมี content รูปแบบ "## N. " ถูกต้อง\n`);
  }

  const client = await connectionPool.connect();

  try {
    // ใช้ transaction: ถ้ามีอะไรพลาดกลางทาง จะ ROLLBACK กลับทั้งหมด ไม่เหลือข้อมูลครึ่ง ๆ กลาง ๆ
    await client.query("BEGIN");

    console.log("2) เตรียมหมวดหมู่...");
    const categoryIdByName = await ensureCategories(client, posts);
    console.log(
      `   มีหมวดหมู่: ${[...categoryIdByName.keys()].sort().join(", ")}\n`
    );

    console.log("3) บันทึกบทความลง database...");
    let inserted = 0;

    for (const post of posts) {
      const categoryId = categoryIdByName.get(post.category);
      if (!categoryId) {
        console.log(`   ข้าม id ${post.id} — ไม่รู้จักหมวดหมู่ "${post.category}"`);
        continue;
      }

      await client.query(
        `INSERT INTO posts (id, title, description, content, category_id, author, image, likes, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9)
         ON CONFLICT (id) DO UPDATE SET
           title       = EXCLUDED.title,
           description = EXCLUDED.description,
           content     = EXCLUDED.content,
           category_id = EXCLUDED.category_id,
           author      = EXCLUDED.author,
           image       = EXCLUDED.image,
           likes       = EXCLUDED.likes,
           status      = EXCLUDED.status,
           created_at  = EXCLUDED.created_at`,
        [
          post.id,
          post.title,
          post.description,
          post.content,
          categoryId,
          post.author,
          post.image,
          post.likes ?? 0,
          post.date,
        ]
      );
      inserted += 1;
    }

    // เราใส่ id เองเพื่อให้ตรงกับ API ต้นทาง แต่ SERIAL ไม่รู้เรื่อง
    // ต้องเลื่อน sequence ไปหลัง id สูงสุด ไม่งั้นการสร้างบทความใหม่จะชน id เดิมทันที
    await client.query(
      `SELECT setval('posts_id_seq', COALESCE((SELECT MAX(id) FROM posts), 1))`
    );

    await client.query("COMMIT");
    console.log(`   บันทึกสำเร็จ ${inserted} บทความ\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const summary = await connectionPool.query(
    `SELECT c.name AS category, COUNT(*) AS total
     FROM posts p JOIN categories c ON c.id = p.category_id
     GROUP BY c.name ORDER BY c.name`
  );
  console.log("สรุปจำนวนบทความแต่ละหมวดหมู่:");
  for (const row of summary.rows) {
    console.log(`   ${row.category}: ${row.total}`);
  }
}

try {
  await main();
  console.log("\n🎉 Seed เสร็จสมบูรณ์");
} catch (error) {
  console.error("\n❌ Seed ล้มเหลว:", error.message);
  process.exitCode = 1;
} finally {
  await connectionPool.end();
}
