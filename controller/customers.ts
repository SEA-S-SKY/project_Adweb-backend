import express from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { config } from "../config";
import { conn } from "../dbconnect";
import { ApiError, badRequest, notFound } from "../lib/http";
import { parseId, parseNearbyQuery, queryString } from "../lib/validate";
import { CustomerRow, parseCustomerInput, toCustomer } from "../model/customer";
import { haversineSql } from "../service/distance";

export const router = express.Router();

async function findCustomer(id: number) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM customers WHERE id = ?", [id]);
  return rows.length ? toCustomer(rows[0] as CustomerRow) : null;
}

// GET /api/customers?search=สม  หรือ  ?firstName=สม&lastName=ใจ
// HW-5 ข้อ 2.1 (แสดงทุกคน) และ 2.2 (ค้นจากส่วนหนึ่งของชื่อ, นามสกุล)
router.get("/", async (req, res) => {
  const search = queryString(req.query.search);
  const firstName = queryString(req.query.firstName);
  const lastName = queryString(req.query.lastName);

  if (search && (firstName || lastName)) {
    throw badRequest("ใช้ search พร้อมกับ firstName/lastName ไม่ได้ เลือกอย่างใดอย่างหนึ่ง", [
      { field: "search", message: "ใช้ร่วมกับ firstName/lastName ไม่ได้" },
    ]);
  }

  const where: string[] = [];
  const params: string[] = [];
  if (search) {
    const like = `%${search}%`;
    where.push(
      "(first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ? OR phone LIKE ?)"
    );
    params.push(like, like, like, like);
  }
  if (firstName) {
    where.push("first_name LIKE ?");
    params.push(`%${firstName}%`);
  }
  if (lastName) {
    where.push("last_name LIKE ?");
    params.push(`%${lastName}%`);
  }

  const sql =
    "SELECT * FROM customers" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY first_name, last_name, id";
  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  res.json((rows as CustomerRow[]).map(toCustomer));
});

// GET /api/customers/nearby?lat=&lng=&radiusKm=1 — HW-5 ข้อ 2.3
// ต้องประกาศก่อน "/:id" ไม่อย่างนั้น Express จะมองว่า "nearby" คือ id
router.get("/nearby", async (req, res) => {
  const { lat, lng, radiusKm } = parseNearbyQuery(req.query, config.nearby.customerRadiusKm);
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT c.*, ${haversineSql("c.lat", "c.lng")} AS distance_km FROM customers c
     ) t
     WHERE distance_km <= ?
     ORDER BY distance_km, id`,
    [lat, lat, lng, radiusKm]
  );
  res.json((rows as CustomerRow[]).map(toCustomer));
});

// GET /api/customers/:id
router.get("/:id", async (req, res) => {
  const customer = await findCustomer(parseId(req.params.id));
  if (!customer) throw notFound("ไม่พบลูกค้า");
  res.json(customer);
});

// POST /api/customers — HW-5 ข้อ 2.1 เพิ่ม
router.post("/", async (req, res) => {
  const c = parseCustomerInput(req.body);
  const [result] = await conn.query<ResultSetHeader>(
    "INSERT INTO customers (first_name, last_name, phone, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)",
    [c.firstName, c.lastName, c.phone, c.address, c.lat, c.lng]
  );
  res.status(201).json(await findCustomer(result.insertId));
});

// PUT /api/customers/:id — HW-5 ข้อ 2.1 แก้ไข (ส่งทุก field)
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const c = parseCustomerInput(req.body);
  if (!(await findCustomer(id))) throw notFound("ไม่พบลูกค้า");
  await conn.query(
    "UPDATE customers SET first_name = ?, last_name = ?, phone = ?, address = ?, lat = ?, lng = ? WHERE id = ?",
    [c.firstName, c.lastName, c.phone, c.address, c.lat, c.lng, id]
  );
  res.json(await findCustomer(id));
});

// DELETE /api/customers/:id — HW-5 ข้อ 2.1 ลบ
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!(await findCustomer(id))) throw notFound("ไม่พบลูกค้า");

  // ลูกค้าที่มีออเดอร์อยู่ (ทุกสถานะ) ลบไม่ได้ เพื่อเก็บประวัติการส่งไว้
  const [orders] = await conn.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?",
    [id]
  );
  const n = Number(orders[0].n);
  if (n > 0) {
    throw new ApiError(409, "CUSTOMER_HAS_ORDERS", `ลบไม่ได้ เพราะลูกค้ามีออเดอร์อยู่ ${n} รายการ`);
  }

  await conn.query("DELETE FROM customers WHERE id = ?", [id]);
  res.status(204).send();
});
