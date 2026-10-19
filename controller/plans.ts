import express from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { conn } from "../dbconnect";
import { ApiError, badRequest, notFound } from "../lib/http";
import { inTransaction } from "../lib/db";
import { parseDate, parseId } from "../lib/validate";
import { ORDER_SELECT, OrderRow } from "../model/order";
import { Plan, PlanResult, PlanRow, toPlan } from "../model/plan";
import { calculatePlanSummary, planWarnings } from "../service/costing";
import { buildRoutes, PlanOrder } from "../service/routing";

export const router = express.Router();

const MAX_SEED = 2147483647; // คอลัมน์ plans.seed เป็น INT

function parseSeed(value: unknown): number {
  if (value === undefined || value === null) return 1 + Math.floor(Math.random() * (MAX_SEED - 1));
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_SEED) {
    throw badRequest("seed ไม่ถูกต้อง", [{ field: "seed", message: `ต้องเป็นจำนวนเต็ม 0–${MAX_SEED}` }]);
  }
  return value;
}

async function findPlan(id: number): Promise<Plan | null> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM plans WHERE id = ?", [id]);
  return rows.length ? toPlan(rows[0] as PlanRow) : null;
}

/** เลขใบงาน MMDD-NN เช่น 0918-01 (API.md หัวข้อ 5) */
function jobPrefix(date: string): string {
  return date.slice(5, 7) + date.slice(8, 10);
}

// POST /api/plans — คำนวณเส้นทาง (ปุ่ม "จัดเส้นทาง" และ "คำนวณใหม่")
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const date = parseDate(body.date, "date");
  const seed = parseSeed(body.seed);

  const [rows] = await conn.query<RowDataPacket[]>(
    `${ORDER_SELECT} WHERE o.order_date = ? AND o.status = 'pending' ORDER BY o.id`,
    [date]
  );
  const orders: PlanOrder[] = (rows as OrderRow[]).map((r) => ({
    orderId: r.id,
    customerId: r.customer_id,
    customerName: `${r.first_name} ${r.last_name}`,
    phone: r.phone,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    quantity: r.quantity,
  }));

  if (!orders.length) {
    const [confirmed] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM plans WHERE plan_date = ? AND status = 'confirmed' LIMIT 1",
      [date]
    );
    if (confirmed.length) {
      throw new ApiError(409, "PLAN_ALREADY_CONFIRMED", `วันที่ ${date} ยืนยันเส้นทางไปแล้ว และไม่มีออเดอร์ใหม่รอจัด`);
    }
    throw new ApiError(400, "NO_ORDERS", `ไม่มีออเดอร์รอจัดเส้นทางในวันที่ ${date}`);
  }

  // คำนวณนอก transaction เพราะต้องรอ OSRM
  const { routes, distanceSource } = await buildRoutes(orders, seed);
  const summary = calculatePlanSummary(routes);
  const result: PlanResult = { distanceSource, routes, summary, warnings: planWarnings(routes, summary) };

  const id = await inTransaction(async (c) => {
    const [ins] = await c.query<ResultSetHeader>(
      "INSERT INTO plans (plan_date, status, seed, result_json) VALUES (?, 'draft', ?, ?)",
      [date, seed, JSON.stringify(result)]
    );
    // แผน draft เก่าของวันนั้นลบทิ้ง เหลือ draft ล่าสุดแผนเดียว
    await c.query("DELETE FROM plans WHERE plan_date = ? AND status = 'draft' AND id <> ?", [date, ins.insertId]);
    return ins.insertId;
  });
  res.status(201).json(await findPlan(id));
});

// GET /api/plans/latest?date= — แผนล่าสุดของวัน (draft หรือ confirmed)
router.get("/latest", async (req, res) => {
  const date = parseDate(req.query.date, "date");
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT * FROM plans WHERE plan_date = ? ORDER BY id DESC LIMIT 1",
    [date]
  );
  if (!rows.length) throw notFound(`ยังไม่มีแผนของวันที่ ${date}`);
  res.json(toPlan(rows[0] as PlanRow));
});

// GET /api/plans/:id
router.get("/:id", async (req, res) => {
  const plan = await findPlan(parseId(req.params.id));
  if (!plan) throw notFound("ไม่พบแผน");
  res.json(plan);
});

// POST /api/plans/:id/confirm — ยืนยันแผน สร้างใบงาน และเปลี่ยนออเดอร์เป็น assigned (transaction เดียว)
router.post("/:id/confirm", async (req, res) => {
  const id = parseId(req.params.id);

  await inTransaction(async (c) => {
    const [planRows] = await c.query<RowDataPacket[]>("SELECT * FROM plans WHERE id = ? FOR UPDATE", [id]);
    if (!planRows.length) throw notFound("ไม่พบแผน");
    const plan = toPlan(planRows[0] as PlanRow);
    if (plan.status === "confirmed") {
      throw new ApiError(409, "PLAN_ALREADY_CONFIRMED", "แผนนี้ยืนยันไปแล้ว");
    }

    // ออเดอร์ต้องยังเหมือนตอนคำนวณ (ยังอยู่ ยัง pending จำนวนกล่องเท่าเดิม)
    const stops = plan.routes.flatMap((r) => r.stops);
    const orderIds = stops.map((s) => s.orderId);
    const [orderRows] = await c.query<RowDataPacket[]>(
      "SELECT id, quantity, status FROM orders WHERE id IN (?) FOR UPDATE",
      [orderIds]
    );
    const current = new Map(orderRows.map((o) => [Number(o.id), o]));
    const changed = stops.filter((s) => {
      const o = current.get(s.orderId);
      return !o || o.status !== "pending" || Number(o.quantity) !== s.quantity;
    });
    if (changed.length) {
      throw new ApiError(
        409,
        "PLAN_OUTDATED",
        `ออเดอร์ ${changed.map((s) => `#${s.orderId}`).join(", ")} ถูกแก้ ลบ หรือจัดไปแล้วหลังคำนวณแผนนี้ กรุณากดคำนวณใหม่`
      );
    }

    // เลขใบงานต่อจากเลขที่ใช้ไปแล้ว (วันเดียวกันยืนยันได้หลายรอบถ้ามีออเดอร์เพิ่มทีหลัง)
    const prefix = jobPrefix(plan.date);
    const [used] = await c.query<RowDataPacket[]>("SELECT job_no FROM jobs WHERE job_no LIKE ? FOR UPDATE", [
      `${prefix}-%`,
    ]);
    let next = Math.max(0, ...used.map((r) => Number(String(r.job_no).slice(prefix.length + 1)) || 0)) + 1;

    for (const route of plan.routes) {
      route.jobNo = `${prefix}-${String(next++).padStart(2, "0")}`;
      const [job] = await c.query<ResultSetHeader>(
        `INSERT INTO jobs (job_no, plan_id, job_date, rider_no, color, total_boxes, distance_km, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [route.jobNo, id, plan.date, route.riderNo, route.color, route.totalBoxes, route.distanceKm, route.cost.total]
      );
      await c.query("INSERT INTO job_stops (job_id, seq, order_id, eta) VALUES ?", [
        route.stops.map((s) => [job.insertId, s.seq, s.orderId, `${s.eta}:00`]),
      ]);
    }

    await c.query("UPDATE orders SET status = 'assigned' WHERE id IN (?)", [orderIds]);
    const result: PlanResult = {
      distanceSource: plan.distanceSource,
      routes: plan.routes,
      summary: plan.summary,
      warnings: plan.warnings,
    };
    await c.query("UPDATE plans SET status = 'confirmed', result_json = ? WHERE id = ?", [
      JSON.stringify(result),
      id,
    ]);
  });

  res.json(await findPlan(id));
});
