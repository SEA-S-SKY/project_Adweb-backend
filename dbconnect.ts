import tls from "tls";
import { createPool, PoolOptions } from "mysql2/promise";
import { LETSENCRYPT_CERTS } from "./lib/ca";

/**
 * ใบรับรองที่เชื่อถือ = root ที่ Node มีอยู่แล้ว + ของ Let's Encrypt (TiDB ใช้ตัวนี้ ดู lib/ca.ts) + DB_SSL_CA ถ้ามี
 * DB_SSL_CA ต้องเป็น "เนื้อหา" ไฟล์ .pem ถ้าใส่เป็น path หรือค่าอื่นจะไม่ใช้ เพราะ Node จะเชื่อถือแค่ค่านั้นแล้วต่อไม่ได้
 */
function trustedCa(): string[] {
  const extra = process.env.DB_SSL_CA?.replace(/\\n/g, "\n").trim();
  const extraPem = extra?.includes("-----BEGIN CERTIFICATE-----") ? [extra] : [];
  if (extra && !extraPem.length) {
    console.warn("DB_SSL_CA ไม่ใช่เนื้อหาใบรับรอง (.pem) จึงไม่ใช้ค่านี้ ถ้าใช้ TiDB ให้ลบ DB_SSL_CA ทิ้ง");
  }
  return [...tls.rootCertificates, ...LETSENCRYPT_CERTS, ...extraPem];
}

/** ค่าเชื่อมต่อฐานข้อมูล อ่านจาก .env (ดู .env.example) */
export function dbOptions(): PoolOptions {
  const useSsl = process.env.DB_SSL === "true" || !!process.env.DB_SSL_CA?.trim();
  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "adweb",
    // TiDB Cloud บังคับ TLS: ใส่ DB_SSL=true ก็พอ
    // ถ้าผู้ให้บริการใช้ CA ของตัวเอง ให้วางเนื้อหาไฟล์ ca.pem ลงใน DB_SSL_CA
    ssl: useSsl ? { minVersion: "TLSv1.2", rejectUnauthorized: true, ca: trustedCa() } : undefined,
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
