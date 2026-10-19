# Plans · Jobs · Events

เอกสารนี้อธิบาย endpoint จัดเส้นทาง ใบงานไรเดอร์ และแจ้งเตือนข้ามเครื่อง ที่ย้ายมาจาก frontend
รูปแบบ request/response ยึดตาม `API.md` หัวข้อ 4–6 ของ repo frontend ส่วนที่**ต่างหรือเพิ่ม**จาก API.md มีเครื่องหมาย 🆕

Base URL: `https://project-adweb-backend.vercel.app/api` (ในเครื่อง `http://localhost:3000/api`)

## ย้ายอะไรมาจาก frontend

| เดิมอยู่ใน frontend | ตอนนี้อยู่ที่ backend |
|---|---|
| `demo-data.service.ts` จัดกลุ่มลูกค้าด้วย sweep + nearest-neighbor + 2-opt | `service/routing.ts` |
| `road-routing.service.ts` เรียก OSRM จัดลำดับใหม่ตามถนน แล้วคิดเงินใหม่ | `service/osrm.ts` + `service/routing.ts` |
| สูตรต้นทุน/กำไรที่เขียนซ้ำ 3 ที่ | `service/costing.ts` |
| `public/_worker.js` (Cloudflare Worker `/api/shared/*`) | `controller/plans.ts`, `controller/jobs.ts`, `controller/events.ts` |
| `cloudflare/schema.sql` (Cloudflare D1: `shared_plans`, `shared_jobs`, `shared_events`) | ตาราง `plans`, `jobs`, `job_stops`, `events` ใน TiDB |
| `scripts/rider-workflow-load-test.mjs`, `scripts/rider-capacity-stress-test.mjs` | `scripts/` ของ repo นี้ (ยิง API ใหม่) |

## อัลกอริทึมจัดเส้นทาง (`service/routing.ts`)

1. **ตารางระยะทาง** ขอระยะตามถนนของทุกคู่จุด (ร้าน + ลูกค้าทุกคน) จาก OSRM `/table` **ครั้งเดียว** ถ้า OSRM ล่มหรือช้าเกิน 6 วินาที ใช้ haversine (เส้นตรง) แทน
2. **กวาดตามมุม (sweep)** เรียงลูกค้าตามมุมรอบร้าน แล้วตัดเป็นกลุ่มละ `maxOrdersPerRider` (3) คนที่อยู่ติดกัน ลองทุกจุดเริ่มและทั้งสองทิศ
3. **ลำดับส่งในกลุ่ม** กลุ่มละ 3 จุดมีแค่ 6 แบบ จึงลองครบทุกแบบ ได้ลำดับที่สั้นที่สุดแน่นอน (กลุ่มเกิน 6 จุดใช้ nearest-neighbor + 2-opt)
4. **ให้คะแนน** คะแนน = ค่าส่งรวม + โทษ 1,000 ต่อจุดที่ส่งเกิน `deadline` แผนที่ส่งทันเวลาจึงชนะเสมอ
5. **seed** seed เดิมได้แผนเดิมเสมอ seed ใหม่สุ่มเลือกจากแผนอันดับต้น ๆ (ไม่เกิน 5 แผน และแพงกว่าแผนที่ดีที่สุดไม่เกิน 3%) ปุ่ม "คำนวณใหม่" จึงได้แผนอื่นที่ดีพอ ๆ กัน
6. **เส้นบนแผนที่** ขอเส้นทางตามถนนของแต่ละไรเดอร์จาก OSRM `/route` มาใส่ใน `path` ถ้าไม่ได้ใช้เส้นตรงต่อจุด

ทดสอบกับออเดอร์จริงวันที่ 2026-10-16 (24 ออเดอร์ 8 ไรเดอร์ ระยะตามถนน) ได้ค่าส่ง **665.27 บาท** เทียบกับอัลกอริทึมเดิมของ frontend **672.65 บาท** ใช้เวลาราว 1–1.7 วินาทีรวมการเรียก OSRM

ค่าตั้งต้นใน `config.ts`

| ค่า | ตอนนี้ | หมายเหตุ |
|---|---|---|
| `delivery.distanceMethod` | `"osrm"` | ⚠️ ข้อ 4 เปลี่ยนจาก `haversine` เพราะ frontend ใหม่ใช้ระยะตามถนนอยู่แล้ว เปลี่ยนกลับได้ที่นี่ที่เดียว |
| `delivery.includeReturnTrip` | `false` | ⚠️ ข้อ 3 ยังรอถามอาจารย์ |
| `routing.osrmUrl` | env `OSRM_URL` หรือ `https://router.project-osrm.org` | |
| `routing.alternativeTolerance` | `0.03` | ปุ่มคำนวณใหม่เลือกได้เฉพาะแผนที่แพงกว่าแผนดีที่สุดไม่เกิน 3% |
| `events.keepDays` | `2` | event เก่ากว่านี้ลบอัตโนมัติ |

## Plans

| Method | Path | Response |
|---|---|---|
| `POST` | `/api/plans` body `{ "date"?, "seed"? }` | `201 Plan` · `400 NO_ORDERS` · `409 PLAN_ALREADY_CONFIRMED` |
| `GET` | `/api/plans/latest?date=` | `200 Plan` · `404` |
| `GET` | `/api/plans/:id` | `200 Plan` · `404` |
| `POST` | `/api/plans/:id/confirm` | `200 Plan` (ทุก route มี `jobNo`) · `404` · `409 PLAN_ALREADY_CONFIRMED` · 🆕 `409 PLAN_OUTDATED` |

- จัดเส้นทางเฉพาะออเดอร์ `pending` ของวันนั้น ทุกครั้งที่เรียกจะลบแผน `draft` เก่าของวันนั้นทิ้ง
- 🆕 **ยืนยันได้หลายรอบต่อวัน** ถ้ามีออเดอร์ใหม่เข้ามาหลังยืนยันแผนแรก `POST /api/plans` จะจัดเฉพาะออเดอร์ใหม่เป็น draft ใหม่ และเลขใบงานต่อจากเดิม (`1020-01…04` แล้วรอบสองได้ `1020-05`) ตอบ `409 PLAN_ALREADY_CONFIRMED` เฉพาะเมื่อวันนั้นยืนยันแล้ว**และ**ไม่มีออเดอร์รอจัด (ตรงกับ flow "มีออเดอร์ใหม่ ต้องกดคำนวณใหม่" ในหน้า plan ของ frontend)
- 🆕 `409 PLAN_OUTDATED` ถ้าออเดอร์ในแผนถูกแก้จำนวนกล่อง ลบ หรือถูกจัดไปแล้ว หลังคำนวณแผนนี้ ให้กดคำนวณใหม่
- 🆕 Plan มี field `distanceSource`: `"osrm"` (ระยะตามถนน) หรือ `"haversine"` (OSRM ใช้ไม่ได้ ระยะเป็นเส้นตรง) ใช้แสดงสถานะบนหน้าจอแทน `roadStatus` เดิม
- `routes[].path` เป็นเส้นตามถนนแล้ว (หลายสิบถึงหลายร้อยจุด) วาดด้วย `L.polyline(path)` ได้เลย

## Jobs

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/jobs?date=` | `200 JobListItem[]` |
| `GET` | `/api/jobs/:jobNo` | `200 Job` · `404` |
| `PATCH` | `/api/jobs/:jobNo/stops/:seq` body `{ "delivered": true \| false }` | `200 Job` · `400` · `404` |

- 🆕 `JobListItem` มี `deliveredCount` (ส่งแล้วกี่จุด)
- 🆕 `Job` มี `path` (เส้นทางตามถนนจากแผน) และ `stops[]` มี `orderId`, `customerId`, `deliveredAt`
- `delivered: true` บันทึกเวลาส่งและเปลี่ยนออเดอร์เป็น `delivered` · กดซ้ำไม่เปลี่ยนเวลาที่ส่งครั้งแรก · `delivered: false` ยกเลิกและเปลี่ยนออเดอร์กลับเป็น `assigned`
- ไม่พบใบงานตอบ `404` (Worker เดิมตอบ `200 null`)

## 🆕 Events (แจ้งเตือนข้ามเครื่อง)

แทน `/api/shared/events` ของ Worker เดิม รูปแบบเหมือนเดิมทุกอย่าง

| Method | Path | Response |
|---|---|---|
| `POST` | `/api/events` body = event object | `201 { "ok": true }` · `400` |
| `GET` | `/api/events?since=ISO8601` | `200` event[] ที่ `createdAt` ใหม่กว่า `since` เรียงเก่า → ใหม่ ไม่เกิน 200 รายการ |

- ต้องมี `id` (≤128 ตัวอักษร), `type` (≤40), `createdAt` (ISO 8601 ที่มี timezone เช่น `new Date().toISOString()`) ส่วน field อื่นเก็บและส่งคืนตามที่ส่งมา (ขนาดรวม ≤ 8 KB)
- ส่ง `id` ซ้ำ = ไม่บันทึกซ้ำ (ยังตอบ 201)
- event เก่ากว่า 2 วันลบอัตโนมัติ

## ตารางฐานข้อมูล

`plans`, `jobs`, `job_stops` ใช้ตามเดิมใน ER (มีอยู่ใน TiDB แล้ว) เพิ่มตาราง `events` 1 ตาราง

| `events` column | type | หมายเหตุ |
|---|---|---|
| `id` | VARCHAR(128) PK | id ที่ frontend สร้าง |
| `event_type` | VARCHAR(40) | เช่น `rider-opened`, `rider-location`, `delivery-completed` |
| `job_no` | VARCHAR(10) NULL | |
| `payload` | JSON | event ทั้งก้อน |
| `created_at` | DATETIME(3) | เวลาไทย แปลงจาก `createdAt` |

ไม่ผูก foreign key เพราะเป็น log ชั่วคราว ถ้าจะใส่ใน ER Diagram ให้วาดเป็นตารางแยก

ฐานข้อมูลที่มีอยู่แล้วใช้ `npm run db:migrate` เพิ่มตารางนี้ (ไม่ลบข้อมูลเดิม) — **TiDB ของทีมรันแล้วเมื่อ 2026-10-20**
