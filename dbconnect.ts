import tls from "tls";
import { createPool, PoolOptions } from "mysql2/promise";
import { LETSENCRYPT_ROOTS } from "./lib/ca";

/** ค่าเชื่อมต่อฐานข้อมูล อ่านจาก .env (ดู .env.example) */
export function dbOptions(): PoolOptions {
  // ไม่ใส่ DB_SSL_CA = ใช้ root ที่ Node เชื่อถืออยู่แล้ว + root ของ Let's Encrypt (TiDB ใช้ตัวนี้ ดู lib/ca.ts)
  const ca = process.env.DB_SSL_CA?.replace(/\\n/g, "\n") || [...tls.rootCertificates, ...LETSENCRYPT_ROOTS];
  const useSsl = process.env.DB_SSL === "true" || !!process.env.DB_SSL_CA;
  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "adweb",
    // TiDB Cloud บังคับ TLS: ใส่ DB_SSL=true ก็พอ
    // ถ้าผู้ให้บริการใช้ CA ของตัวเอง ให้วางเนื้อหาไฟล์ ca.pem ลงใน DB_SSL_CA
    ssl: useSsl ? { minVersion: "TLSv1.2", rejectUnauthorized: true, ca } : undefined,
    // DATE / DATETIME ได้กลับมาเป็น string ตรง ๆ ไม่โดนแปลง timezone
    dateStrings: true,
    // DECIMAL (lat, lng, SUM) ได้กลับมาเป็น number
    decimalNumbers: true,
    charset: "utf8mb4",
  };
}

export const conn = createPool({ ...dbOptions(), connectionLimit: 10 });

// ให้ CURRENT_TIMESTAMP และ CURDATE() เป็นเวลาไทย ไม่ว่า server ฐานข้อมูลจะอยู่ timezone ไหน
conn.on("connection", (connection) => {
  connection.query("SET time_zone = '+07:00'");
});
