// สร้างฐานข้อมูล (ถ้ายังไม่มี) + ตารางทั้งหมด + ลูกค้าตัวอย่าง จาก sql/schema.sql
// ใช้ได้ทั้งฐานข้อมูลในเครื่องและบน TiDB Cloud (ไม่ต้องลง mysql client)
// รัน: npm run db:init
import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import { createConnection } from "mysql2/promise";
import { dbOptions } from "../dbconnect";

async function main() {
  const sql = readFileSync(path.join(process.cwd(), "sql", "schema.sql"), "utf8");
  const { host, database, ...rest } = dbOptions();
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`DB_NAME "${database}" ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และ _`);
  }
  console.log(`กำลังสร้างฐานข้อมูล ${database} @ ${host} ...`);

  // ต่อแบบยังไม่เลือกฐานข้อมูล เพื่อสร้างฐานข้อมูลได้ถ้ายังไม่มี
  const c = await createConnection({ ...rest, host, multipleStatements: true });
  try {
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4`);
    await c.query(`USE \`${database}\``);
    await c.query(sql);
    const [rows] = await c.query("SELECT COUNT(*) AS n FROM customers");
    console.log(`เสร็จแล้ว มีลูกค้า ${(rows as { n: number }[])[0].n} คน`);
  } finally {
    await c.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("สร้างฐานข้อมูลไม่สำเร็จ:", e.message);
    process.exit(1);
  });
