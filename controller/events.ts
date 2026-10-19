// /api/events — เหตุการณ์แจ้งเตือนข้ามเครื่อง (ไรเดอร์เปิดงาน, ส่งสำเร็จ, ตำแหน่ง GPS ฯลฯ)
// หน้าแอดมินดึงของใหม่ด้วย polling: GET /api/events?since=<createdAt ล่าสุดที่เห็น>
// แทน /api/shared/events ที่เคยอยู่ใน Cloudflare Worker ของ frontend
import express from "express";
import { RowDataPacket } from "mysql2/promise";
import { config } from "../config";
import { conn } from "../dbconnect";
import { badRequest, ErrorDetail } from "../lib/http";
import { queryString } from "../lib/validate";
import { parseJson } from "../model/plan";

export const router = express.Router();

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** ISO 8601 (มี timezone) → "YYYY-MM-DD HH:mm:ss.SSS" เวลาไทย สำหรับคอลัมน์ DATETIME(3) */
function toBangkokDateTime(iso: string): string | null {
  // ต้องมี timezone (Z หรือ +07:00) ไม่งั้นแต่ละเครื่องตีความเวลาไม่ตรงกัน
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + BANGKOK_OFFSET_MS).toISOString().slice(0, 23).replace("T", " ");
}

// GET /api/events?since=ISO8601 — event ที่ createdAt ใหม่กว่า since เรียงเก่า → ใหม่ (ไม่ส่ง since = ย้อนหลัง 30 นาที)
router.get("/", async (req, res) => {
  const sinceRaw = queryString(req.query.since);
  const since = sinceRaw
    ? toBangkokDateTime(sinceRaw)
    : toBangkokDateTime(new Date(Date.now() - 30 * 60 * 1000).toISOString());
  if (!since) {
    throw badRequest("since ต้องเป็นวันเวลา ISO 8601 ที่มี timezone", [
      { field: "since", message: "เช่น 2026-10-20T04:30:00.000Z" },
    ]);
  }
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT payload FROM events WHERE created_at > ? ORDER BY created_at, id LIMIT ?",
    [since, config.events.maxPerRequest]
  );
  res.json(rows.map((r) => parseJson(r.payload)));
});

// POST /api/events — บันทึก event 1 รายการ (ส่ง id ซ้ำ = ไม่บันทึกซ้ำ)
router.post("/", async (req, res) => {
  const body = req.body;
  const details: ErrorDetail[] = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("body ต้องเป็น JSON object");
  }
  const { id, type, createdAt, jobNo } = body as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim() || id.length > 128) {
    details.push({ field: "id", message: "บังคับ ข้อความยาวไม่เกิน 128 ตัวอักษร" });
  }
  if (typeof type !== "string" || !type.trim() || type.length > 40) {
    details.push({ field: "type", message: "บังคับ ข้อความยาวไม่เกิน 40 ตัวอักษร" });
  }
  const created = typeof createdAt === "string" ? toBangkokDateTime(createdAt) : null;
  if (!created) details.push({ field: "createdAt", message: "บังคับ วันเวลา ISO 8601 ที่มี timezone" });
  if (jobNo !== undefined && jobNo !== null && (typeof jobNo !== "string" || jobNo.length > 10)) {
    details.push({ field: "jobNo", message: "ข้อความยาวไม่เกิน 10 ตัวอักษร" });
  }
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload) > config.events.maxPayloadBytes) {
    details.push({ field: "body", message: `ขนาดต้องไม่เกิน ${config.events.maxPayloadBytes} ไบต์` });
  }
  if (details.length) throw badRequest("ข้อมูล event ไม่ครบหรือไม่ถูกต้อง", details);

  await conn.query(
    "INSERT IGNORE INTO events (id, event_type, job_no, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, type, typeof jobNo === "string" ? jobNo : null, payload, created]
  );
  // ลบ event เก่า ตารางจะได้ไม่โตเรื่อย ๆ (GPS ไรเดอร์ส่งมาทุกไม่กี่วินาที)
  await conn.query("DELETE FROM events WHERE created_at < NOW() - INTERVAL ? DAY", [config.events.keepDays]);
  res.status(201).json({ ok: true });
});
