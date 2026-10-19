import express from "express";
import { RowDataPacket } from "mysql2/promise";
import { conn } from "../dbconnect";
import { inTransaction } from "../lib/db";
import { badRequest, notFound } from "../lib/http";
import { parseDate, parseId } from "../lib/validate";
import { JOB_SELECT, JOB_STOP_SELECT, JobRow, JobStopRow, toJob, toJobListItem } from "../model/job";

export const router = express.Router();

async function findJob(jobNo: string) {
  const [rows] = await conn.query<RowDataPacket[]>(`${JOB_SELECT} WHERE j.job_no = ?`, [jobNo]);
  if (!rows.length) return null;
  const job = rows[0] as JobRow;
  const [stops] = await conn.query<RowDataPacket[]>(`${JOB_STOP_SELECT} WHERE s.job_id = ? ORDER BY s.seq`, [
    job.id,
  ]);
  return toJob(job, stops as JobStopRow[]);
}

// GET /api/jobs?date= — ใบงานทั้งหมดของวัน (ให้เจ้าของร้านแจกเลขใบงาน)
router.get("/", async (req, res) => {
  const date = parseDate(req.query.date, "date");
  const [rows] = await conn.query<RowDataPacket[]>(`${JOB_SELECT} WHERE j.job_date = ? ORDER BY j.job_no`, [date]);
  res.json((rows as JobRow[]).map(toJobListItem));
});

// GET /api/jobs/:jobNo — ใบงาน 1 ใบ (หน้าไรเดอร์)
router.get("/:jobNo", async (req, res) => {
  const job = await findJob(req.params.jobNo.trim());
  if (!job) throw notFound("ไม่พบใบงาน");
  res.json(job);
});

// PATCH /api/jobs/:jobNo/stops/:seq — ไรเดอร์กดว่าส่งแล้ว (หรือกดยกเลิก)
router.patch("/:jobNo/stops/:seq", async (req, res) => {
  const jobNo = req.params.jobNo.trim();
  const seq = parseId(req.params.seq, "seq");
  const delivered = (req.body ?? {}).delivered;
  if (typeof delivered !== "boolean") {
    throw badRequest("delivered ต้องเป็น true หรือ false", [{ field: "delivered", message: "บังคับ ต้องเป็น boolean" }]);
  }

  await inTransaction(async (c) => {
    const [rows] = await c.query<RowDataPacket[]>(
      `SELECT s.id, s.order_id FROM job_stops s JOIN jobs j ON j.id = s.job_id
       WHERE j.job_no = ? AND s.seq = ? FOR UPDATE`,
      [jobNo, seq]
    );
    if (!rows.length) throw notFound("ไม่พบจุดส่งนี้ในใบงาน");
    const stop = rows[0];
    // กดส่งซ้ำไม่เปลี่ยนเวลาที่ส่งครั้งแรก
    await c.query(
      `UPDATE job_stops SET delivered_at = ${delivered ? "COALESCE(delivered_at, NOW())" : "NULL"} WHERE id = ?`,
      [stop.id]
    );
    await c.query("UPDATE orders SET status = ? WHERE id = ?", [delivered ? "delivered" : "assigned", stop.order_id]);
  });

  res.json(await findJob(jobNo));
});
