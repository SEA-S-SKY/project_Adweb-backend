import express from "express";
import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { config } from "../config";
import { conn } from "../dbconnect";
import { ApiError, badRequest, notFound } from "../lib/http";
import { parseDate, parseId, parseNearbyQuery, queryString } from "../lib/validate";
import { ORDER_SELECT, ORDER_STATUSES, OrderRow, OrderStatus, toOrder } from "../model/order";
import { haversineSql } from "../service/distance";

export const router = express.Router();

const MAX_BOXES = config.delivery.maxBoxesPerOrder;

function parseStatus(value: unknown): OrderStatus | undefined {
  const s = queryString(value);
  if (s === undefined) return undefined;
  if (!ORDER_STATUSES.includes(s as OrderStatus)) {
    throw badRequest("status ไม่ถูกต้อง", [{ field: "status", message: `ต้องเป็น ${ORDER_STATUSES.join(" / ")}` }]);
  }
  return s as OrderStatus;
}

function parseQuantity(value: unknown): number {
  const q = Number(value);
  if (typeof value !== "number" || !Number.isInteger(q) || q < 1 || q > MAX_BOXES) {
    throw badRequest(`จำนวนกล่องต้องอยู่ระหว่าง 1 ถึง ${MAX_BOXES}`, [
      { field: "quantity", message: `ต้องเป็นจำนวนเต็ม 1–${MAX_BOXES}` },
    ]);
  }
  return q;
}

async function findOrder(id: number) {
  const [rows] = await conn.query<RowDataPacket[]>(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
  return rows.length ? toOrder(rows[0] as OrderRow) : null;
}

/** แก้/ลบได้เฉพาะออเดอร์ pending */
async function findEditableOrder(id: number) {
  const order = await findOrder(id);
  if (!order) throw notFound("ไม่พบออเดอร์");
  if (order.status !== "pending") {
    throw new ApiError(409, "ORDER_LOCKED", "ออเดอร์นี้ยืนยันเส้นทางแล้ว แก้ไขหรือลบไม่ได้");
  }
  return order;
}

async function inTransaction<T>(work: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await conn.getConnection();
  try {
    await c.beginTransaction();
    const result = await work(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

// GET /api/orders?date=&status=
router.get("/", async (req, res) => {
  const date = parseDate(req.query.date, "date");
  const status = parseStatus(req.query.status);
  const [rows] = await conn.query<RowDataPacket[]>(
    `${ORDER_SELECT} WHERE o.order_date = ?` + (status ? " AND o.status = ?" : "") + " ORDER BY o.id",
    status ? [date, status] : [date]
  );
  res.json((rows as OrderRow[]).map(toOrder));
});

// GET /api/orders/summary?date=
router.get("/summary", async (req, res) => {
  const date = parseDate(req.query.date, "date");
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS orderCount,
            COALESCE(SUM(quantity), 0) AS totalBoxes,
            COALESCE(SUM(status = 'pending'), 0) AS pending,
            COALESCE(SUM(status = 'assigned'), 0) AS assigned,
            COALESCE(SUM(status = 'delivered'), 0) AS delivered
     FROM orders WHERE order_date = ?`,
    [date]
  );
  const r = rows[0];
  res.json({
    date,
    orderCount: Number(r.orderCount),
    totalBoxes: Number(r.totalBoxes),
    byStatus: { pending: Number(r.pending), assigned: Number(r.assigned), delivered: Number(r.delivered) },
  });
});

// GET /api/orders/nearby?lat=&lng=&radiusKm=2&date=&status= — HW-5 ข้อ 3.3
router.get("/nearby", async (req, res) => {
  const { lat, lng, radiusKm } = parseNearbyQuery(req.query, config.nearby.orderRadiusKm);
  const date = parseDate(req.query.date, "date", false); // ไม่ส่ง = ทุกวัน
  const status = parseStatus(req.query.status);

  const where: string[] = [];
  const params: (string | number)[] = [lat, lat, lng];
  if (date) {
    where.push("o.order_date = ?");
    params.push(date);
  }
  if (status) {
    where.push("o.status = ?");
    params.push(status);
  }
  params.push(radiusKm);

  const inner =
    ORDER_SELECT.replace("c.lat, c.lng", `c.lat, c.lng, ${haversineSql("c.lat", "c.lng")} AS distance_km`) +
    (where.length ? " WHERE " + where.join(" AND ") : "");
  const sql = `SELECT * FROM (${inner}) t WHERE distance_km <= ? ORDER BY distance_km, id`;

  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  res.json((rows as OrderRow[]).map(toOrder));
});

// POST /api/orders/simulate — HW-5 ข้อ 3.1 จำลองออเดอร์ 20–30 รายการ
router.post("/simulate", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const date = parseDate(body.orderDate, "orderDate");
  const replaceExisting = body.replaceExisting === undefined ? true : body.replaceExisting === true;

  const { minOrders, maxOrders } = config.simulate;
  let count: number;
  if (body.count === undefined || body.count === null) {
    count = minOrders + Math.floor(Math.random() * (maxOrders - minOrders + 1));
  } else {
    count = Number(body.count);
    if (typeof body.count !== "number" || !Number.isInteger(count) || count < 1 || count > 100) {
      throw badRequest("count ต้องเป็นจำนวนเต็ม 1–100", [{ field: "count", message: "จำนวนเต็ม 1–100" }]);
    }
  }

  const customerIds = await inTransaction(async (c) => {
    if (replaceExisting) {
      await c.query("DELETE FROM orders WHERE order_date = ? AND status = 'pending'", [date]);
    }
    // ลูกค้า 1 คนมีได้ไม่เกิน 1 ออเดอร์ต่อวัน
    const [candidates] = await c.query<RowDataPacket[]>(
      "SELECT id FROM customers WHERE id NOT IN (SELECT customer_id FROM orders WHERE order_date = ?)",
      [date]
    );
    if (candidates.length < count) {
      throw badRequest(
        `มีลูกค้าที่ยังไม่มีออเดอร์วันที่ ${date} อยู่ ${candidates.length} คน ไม่พอสำหรับ ${count} ออเดอร์ เพิ่มลูกค้าก่อน`,
        [{ field: "count", message: `ได้ไม่เกิน ${candidates.length}` }]
      );
    }
    // สุ่มลูกค้า (Fisher–Yates) และจำนวนกล่อง 1–3
    const ids = candidates.map((r) => Number(r.id));
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const chosen = ids.slice(0, count);
    const values = chosen.map((id) => [id, 1 + Math.floor(Math.random() * MAX_BOXES), date]);
    await c.query("INSERT INTO orders (customer_id, quantity, order_date) VALUES ?", [values]);
    return chosen;
  });

  const [rows] = await conn.query<RowDataPacket[]>(
    `${ORDER_SELECT} WHERE o.order_date = ? AND o.customer_id IN (?) ORDER BY o.id`,
    [date, customerIds]
  );
  res.status(201).json((rows as OrderRow[]).map(toOrder));
});

// DELETE /api/orders/all — HW-5 ข้อ 3.2 ล้างข้อมูลจำลองทั้งหมด (ทุกวัน ทุกสถานะ รวมแผนและใบงาน)
router.delete("/all", async (req, res) => {
  const result = await inTransaction(async (c) => {
    // ลบตามลำดับ foreign key: job_stops → jobs → plans → orders
    await c.query("DELETE FROM job_stops");
    const [jobs] = await c.query<ResultSetHeader>("DELETE FROM jobs");
    const [plans] = await c.query<ResultSetHeader>("DELETE FROM plans");
    const [orders] = await c.query<ResultSetHeader>("DELETE FROM orders");
    return { deletedOrders: orders.affectedRows, deletedPlans: plans.affectedRows, deletedJobs: jobs.affectedRows };
  });
  res.json(result);
});

// GET /api/orders/:id
router.get("/:id", async (req, res) => {
  const order = await findOrder(parseId(req.params.id));
  if (!order) throw notFound("ไม่พบออเดอร์");
  res.json(order);
});

// POST /api/orders — HW-5 ข้อ 3.1.3 เพิ่ม
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const customerId = Number(body.customerId);
  if (typeof body.customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0) {
    throw badRequest("customerId ไม่ถูกต้อง", [{ field: "customerId", message: "บังคับ ต้องเป็นจำนวนเต็มบวก" }]);
  }
  const quantity = parseQuantity(body.quantity);
  const date = parseDate(body.orderDate, "orderDate");

  const [customers] = await conn.query<RowDataPacket[]>("SELECT id FROM customers WHERE id = ?", [customerId]);
  if (!customers.length) {
    throw badRequest("ไม่พบลูกค้ารหัสนี้", [{ field: "customerId", message: "ไม่มีลูกค้ารหัสนี้" }]);
  }

  const [result] = await conn.query<ResultSetHeader>(
    "INSERT INTO orders (customer_id, quantity, order_date) VALUES (?, ?, ?)",
    [customerId, quantity, date]
  );
  res.status(201).json(await findOrder(result.insertId));
});

// PATCH /api/orders/:id — HW-5 ข้อ 3.1.3 แก้จำนวนกล่อง
router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const quantity = parseQuantity((req.body ?? {}).quantity);
  await findEditableOrder(id);
  await conn.query("UPDATE orders SET quantity = ? WHERE id = ?", [quantity, id]);
  res.json(await findOrder(id));
});

// DELETE /api/orders/:id — HW-5 ข้อ 3.1.3 ลบ
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  await findEditableOrder(id);
  await conn.query("DELETE FROM orders WHERE id = ?", [id]);
  res.status(204).send();
});

// DELETE /api/orders?date= — ลบออเดอร์ pending ทั้งหมดของวันนั้น (ปุ่ม "ล้างออเดอร์ที่รอจัด")
router.delete("/", async (req, res) => {
  const date = parseDate(req.query.date, "date");
  await conn.query("DELETE FROM orders WHERE order_date = ? AND status = 'pending'", [date]);
  res.status(204).send();
});
