# project_Adweb-backend — Web API

Express 5 + TypeScript + MySQL 8 (`mysql2/promise`) ตามแบบวิชา Web API
backend ของ [project_Adweb](https://github.com/SEA-S-SKY/project_Adweb) (frontend Angular อยู่ใน repo นั้น)

สัญญาของทุก endpoint อยู่ใน [API.md](https://github.com/SEA-S-SKY/project_Adweb/blob/master/API.md) ของ repo frontend ส่วนตารางฐานข้อมูลอยู่ใน [docs/er-diagram.md](https://github.com/SEA-S-SKY/project_Adweb/blob/master/docs/er-diagram.md) **ถ้าจะเปลี่ยน API ให้แก้ API.md ใน repo frontend ก่อน**

ตอนนี้ทำครบทุกข้อของ **HW-5** แล้ว (config, ลูกค้า, ออเดอร์) และมี `/api/plans` (จัดเส้นทาง) `/api/jobs` (ใบงานไรเดอร์) `/api/events` (แจ้งเตือนข้ามเครื่อง) แล้ว รายละเอียดอยู่ใน [docs/PLANS_JOBS_EVENTS.md](docs/PLANS_JOBS_EVENTS.md)

> [!IMPORTANT]
> อัลกอริทึมจัดเส้นทางและการเก็บใบงานอยู่ที่ backend นี้ที่เดียว ฝั่ง frontend ไม่ต้องคำนวณเองหรือมีฐานข้อมูลของตัวเองแล้ว
> สิ่งที่ฝั่ง frontend ต้องแก้ดูที่ [docs/FRONTEND_MIGRATION.md](docs/FRONTEND_MIGRATION.md)

## เริ่มต้นใช้งานในเครื่อง

ต้องมี Node.js (LTS) และ MySQL 8 ในเครื่อง (XAMPP/MariaDB 10.5+ ก็ใช้ได้)

```bash
git clone https://github.com/SEA-S-SKY/project_Adweb-backend.git
cd project_Adweb-backend
npm install
cp .env.example .env        # Windows: copy .env.example .env แล้วแก้รหัส DB
```

แก้ `DB_USER` / `DB_PASSWORD` ใน `.env` ให้ตรงกับ MySQL ในเครื่อง แล้วรัน

```bash
npm run db:init   # สร้างฐานข้อมูล adweb (ถ้ายังไม่มี) + 6 ตาราง + ลูกค้าตัวอย่าง 30 คน (⚠️ ลบข้อมูลเดิมในตารางทิ้งทั้งหมด)
npm run dev       # เปิด server ที่ http://localhost:3000 รีสตาร์ตเองเมื่อเซฟไฟล์
```

ลองเปิด http://localhost:3000/api/customers ต้องเห็นลูกค้า 30 คน

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รันแบบพัฒนา (`tsx watch`) |
| `npm run build` | คอมไพล์เป็น JavaScript ลง `dist/` |
| `npm start` | รันตัวที่คอมไพล์แล้วในเครื่อง (บน Vercel ไม่ได้ใช้) |
| `npm run db:init` | สร้างตารางใหม่ทั้งหมดจาก `sql/schema.sql` (⚠️ ลบข้อมูลเดิม) |
| `npm run db:migrate` | เพิ่มตารางที่ยังไม่มี (เช่น `events`) **โดยไม่ลบข้อมูลเดิม** ใช้กับฐานข้อมูลที่มีอยู่แล้ว รันซ้ำได้ |
| `npm run db:clear-date -- 2099-12-31` | ลบออเดอร์ แผน ใบงาน และ event ของวันเดียว (ใช้ล้างวันที่ทดสอบ) |
| `npm test` | unit test สูตรต้นทุนและอัลกอริทึมจัดเส้นทาง (ไม่ต่อฐานข้อมูล) |
| `npm run test:rider-workflow` | จำลองไรเดอร์ทุกคนวิ่งงานพร้อมกันบนวันที่ทดสอบ (ต้องเปิด server ก่อน ดูหัวไฟล์) |
| `npm run test:rider-capacity` | เพิ่มผู้ใช้พร้อมกันทีละขั้นจน error/latency เกินเกณฑ์ (ดูหัวไฟล์) |

## โครงสร้างไฟล์

```
project_Adweb-backend/
├── server.ts            เปิดพอร์ต
├── app.ts               CORS, JSON parser, ผูก router ใต้ /api, จัดการ error
├── dbconnect.ts         connection pool (ตั้ง time_zone เป็น +07:00 ให้ทุก connection)
├── config.ts            ค่าคงที่ทั้งระบบ (ราคา, รัศมี, เวลา, สีไรเดอร์)
├── controller/          config, customers, orders, plans, jobs, events
├── model/               interface + ตัวแปลง snake_case → camelCase + ตัวตรวจ body
├── lib/                 http.ts (รูปแบบ error กลาง), validate.ts, format.ts, db.ts (transaction), ca.ts (ใบรับรอง Let's Encrypt)
├── service/
│   ├── distance.ts      haversine
│   ├── osrm.ts          ระยะทางและเส้นทางตามถนนจริงจาก OSRM
│   ├── routing.ts       อัลกอริทึมจัดเส้นทางและแบ่งงานไรเดอร์
│   └── costing.ts       สูตรต้นทุน กำไร และคำเตือน
├── scripts/             init-db.ts, migrate.ts, clear-date.ts, load test ไรเดอร์ 2 ตัว
├── sql/schema.sql       CREATE TABLE ทั้งหมด + ลูกค้าตัวอย่าง
├── test/                unit test (node:test)
└── postman/             collection สำหรับทดสอบทุกเส้น
```

อธิบายการทำงานของแต่ละไฟล์อย่างละเอียดอยู่ใน [docs/FILES.md](docs/FILES.md)

**เพิ่ม endpoint ใหม่:** throw `ApiError` / `badRequest()` / `notFound()` จาก `lib/http.ts` ได้เลย Express 5 ส่ง error จาก async handler ไปที่ `errorHandler` ให้เอง ไม่ต้องเขียน try/catch ทุกเส้น

## Endpoint ที่ทำแล้ว

| Method | Path | HW-5 |
|---|---|---|
| GET | `/api/config` | |
| GET | `/api/customers` · `?search=` · `?firstName=&lastName=` | 2.1, 2.2 |
| GET | `/api/customers/nearby?lat=&lng=&radiusKm=1` | 2.3 |
| GET | `/api/customers/:id` | |
| POST | `/api/customers` | 2.1 |
| PUT | `/api/customers/:id` | 2.1 |
| DELETE | `/api/customers/:id` | 2.1 |
| GET | `/api/orders?date=&status=` | |
| GET | `/api/orders/summary?date=` | |
| GET | `/api/orders/nearby?lat=&lng=&radiusKm=2&date=&status=` | 3.3 |
| GET | `/api/orders/:id` | |
| POST | `/api/orders` | 3.1.3 |
| PATCH | `/api/orders/:id` | 3.1.3 |
| DELETE | `/api/orders/:id` | 3.1.3 |
| POST | `/api/orders/simulate` | 3.1 |
| DELETE | `/api/orders?date=` | |
| DELETE | `/api/orders/all` | 3.2 |
| POST | `/api/plans` | จัดเส้นทาง / คำนวณใหม่ |
| GET | `/api/plans/latest?date=` | |
| GET | `/api/plans/:id` | |
| POST | `/api/plans/:id/confirm` | ยืนยันแผน + สร้างใบงาน |
| GET | `/api/jobs?date=` | |
| GET | `/api/jobs/:jobNo` | หน้าไรเดอร์ |
| PATCH | `/api/jobs/:jobNo/stops/:seq` | ไรเดอร์กดส่งแล้ว |
| GET | `/api/events?since=` | แจ้งเตือนข้ามเครื่อง |
| POST | `/api/events` | |

## ทดสอบด้วย Postman

Import ไฟล์ `postman/project_Adweb.postman_collection.json` แล้วแก้ตัวแปร `baseUrl` ของ collection
- ในเครื่อง: `http://localhost:3000/api`
- หลัง deploy: `https://<ชื่อโปรเจกต์>.vercel.app/api`

## Deploy (HW-5 ข้อ 4)

ฐานข้อมูลใช้ **TiDB Cloud Starter** (ฟรี, ต่อแบบ MySQL) และ backend ขึ้น **Vercel** (ฟรี, แพ็กเกจ Hobby)

### 1. สร้างฐานข้อมูลบน TiDB Cloud
1. สมัครที่ [tidbcloud.com](https://tidbcloud.com) แล้วสร้าง instance แบบ **Starter** (ฟรี) เลือก region **Singapore (ap-southeast-1)** เพราะใกล้ไทยที่สุด
2. เข้าหน้า instance → กด **Connect** มุมขวาบน → ตั้ง Connection Type = **Public**, Connect With = **General**
3. กด **Generate Password** แล้ว**จดรหัสไว้ทันที** (ปิดหน้าต่างแล้วจะดูรหัสเดิมไม่ได้อีก)
4. จดค่า **HOST**, **PORT** (4000) และ **USERNAME** (หน้าตาแบบ `xxxxxxxxxxxx.root`)

### 2. สร้างตารางจากเครื่องตัวเอง (ทำครั้งเดียว)
แก้ `.env` ในเครื่องให้ชี้ไปที่ TiDB

```env
DB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
DB_PORT=4000
DB_USER=xxxxxxxxxxxx.root
DB_PASSWORD=รหัสที่จดไว้
DB_NAME=adweb
DB_SSL=true
```

แล้วรัน `npm run db:init` ต้องขึ้น `เสร็จแล้ว มีลูกค้า 30 คน` (ฐานข้อมูล `adweb` ถูกสร้างให้อัตโนมัติ)
จากนั้นลอง `npm run dev` แล้วเปิด http://localhost:3000/api/customers ถ้าเห็นลูกค้า 30 คน แปลว่า backend ในเครื่องต่อ TiDB ได้แล้ว

### 3. Backend บน Vercel
Vercel รัน Express เป็น serverless function ให้เอง โดยหยิบ `export default app` จาก `app.ts` (ไม่ได้รัน `server.ts`) และ `vercel.json` ตั้ง region เป็น `sin1` (สิงคโปร์) ให้อยู่ที่เดียวกับ TiDB

1. สมัคร/ล็อกอิน [vercel.com](https://vercel.com) ด้วยบัญชี GitHub (แพ็กเกจ **Hobby** ฟรี)
2. **Add New… → Project** → Import repo `project_Adweb-backend` (ถ้าไม่เห็น repo ให้กด *Adjust GitHub App Permissions* แล้วอนุญาต repo นี้)
3. หน้าตั้งค่า: Framework Preset ต้องขึ้น **Express** ช่องอื่นปล่อยค่าเดิม
4. เปิด **Environment Variables** แล้วใส่

| Key | Value |
|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` `DB_SSL` | ค่าเดียวกับข้อ 2 |
| `CORS_ORIGINS` | ช่วงแรกใส่ `*` พอ frontend deploy แล้วค่อยเปลี่ยนเป็น URL ของ frontend |
| `OSRM_URL` | ไม่ต้องใส่ก็ได้ (ค่าเริ่มต้น `https://router.project-osrm.org`) ใส่เมื่อมี OSRM ของตัวเอง |

5. กด **Deploy** เสร็จแล้วลองเปิด `https://<ชื่อโปรเจกต์>.vercel.app/api/customers` ต้องเห็นลูกค้า 30 คน

หลังจากนี้ทุกครั้งที่ merge เข้า `master` Vercel จะ deploy ใหม่ให้เอง ส่วน branch อื่นจะได้ URL ทดลอง (Preview) แยกไว้

> [!NOTE]
> - **URL ที่ส่งอาจารย์ให้ใช้ตัวในหัวข้อ Domains** (`<ชื่อโปรเจกต์>.vercel.app`) ห้ามใช้ URL ยาว ๆ ที่มีรหัสสุ่มต่อท้าย เพราะ URL แบบนั้นถูกล็อกไว้ให้เฉพาะคนที่ล็อกอิน Vercel ของทีม
> - แก้ Environment Variables แล้ว**ต้อง Redeploy** (แท็บ Deployments → ⋯ → Redeploy) ค่าใหม่ถึงจะมีผล
> - ดู error ตอนรันได้ที่แท็บ **Logs** ของโปรเจกต์
> - TiDB บังคับเชื่อมต่อแบบ TLS ถ้าลืมใส่ `DB_SSL=true` จะเชื่อมต่อไม่ได้
> - ถ้าเจอ `unable to get local issuer certificate` แปลว่า Node ไม่รู้จักใบรับรองของ TiDB (สาย Let's Encrypt YE1 → Root YE) root ที่ต้องใช้แนบไว้ใน `lib/ca.ts` แล้ว ห้ามลบ
> - TiDB ยังไม่รองรับฟังก์ชัน spatial (`ST_Distance_Sphere`, `POINT`) การคำนวณระยะจึงใช้ `haversineSql()` ใน `service/distance.ts` ห้ามเปลี่ยนกลับ
> - เพิ่มตารางใหม่ใน `sql/schema.sql` เมื่อไหร่ ให้เพิ่มใน `scripts/migrate.ts` ด้วย แล้วรัน `npm run db:migrate` กับ TiDB **ก่อน** merge (ห้ามใช้ `db:init` กับฐานข้อมูลจริง เพราะลบข้อมูลทั้งหมด)
