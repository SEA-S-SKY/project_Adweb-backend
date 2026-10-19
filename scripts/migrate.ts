// เพิ่มตารางใหม่ให้ฐานข้อมูลที่มีอยู่แล้ว โดยไม่ลบข้อมูลเดิม (ต่างจาก db:init ที่ DROP ทุกตาราง)
// รันซ้ำได้ ตารางไหนมีแล้วจะข้าม
// รัน: npm run db:migrate
import "dotenv/config";
import { conn } from "../dbconnect";

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "events",
    sql: `CREATE TABLE IF NOT EXISTS events (
      id          VARCHAR(128) NOT NULL,
      event_type  VARCHAR(40)  NOT NULL,
      job_no      VARCHAR(10)  NULL,
      payload     JSON         NOT NULL,
      created_at  DATETIME(3)  NOT NULL,
      PRIMARY KEY (id),
      INDEX idx_events_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
];

async function main() {
  for (const m of MIGRATIONS) {
    await conn.query(m.sql);
    console.log(`✓ ${m.name}`);
  }
  const [rows] = await conn.query("SHOW TABLES");
  console.log("ตารางทั้งหมด:", (rows as Record<string, string>[]).map((r) => Object.values(r)[0]).join(", "));
}

main()
  .then(() => conn.end())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("migrate ไม่สำเร็จ:", e.message);
    process.exit(1);
  });
