# project_Adweb-backend — Web API

Express 5 + TypeScript + MySQL 8 (`mysql2/promise`) ตามแบบวิชา Web API
backend ของ [project_Adweb](https://github.com/SEA-S-SKY/project_Adweb) (frontend Angular อยู่ใน repo นั้น)

สัญญาของทุก endpoint อยู่ใน [API.md](https://github.com/SEA-S-SKY/project_Adweb/blob/master/API.md) ของ repo frontend ส่วนตารางฐานข้อมูลอยู่ใน [docs/er-diagram.md](https://github.com/SEA-S-SKY/project_Adweb/blob/master/docs/er-diagram.md) **ถ้าจะเปลี่ยน API ให้แก้ API.md ใน repo frontend ก่อน**

ตอนนี้ทำครบทุกข้อของ **HW-5** แล้ว (config, ลูกค้า, ออเดอร์) ส่วน `/api/plans` และ `/api/jobs` ยังไม่ได้ทำ

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
npm run db:init   # สร้างฐานข้อมูล adweb (ถ้ายังไม่มี) + 5 ตาราง + ลูกค้าตัวอย่าง 30 คน (⚠️ ลบข้อมูลเดิมในตารางทิ้งทั้งหมด)
npm run dev       # เปิด server ที่ http://localhost:3000 รีสตาร์ตเองเมื่อเซฟไฟล์
```

ลองเปิด http://localhost:3000/api/customers ต้องเห็นลูกค้า 30 คน

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รันแบบพัฒนา (`tsx watch`) |
| `npm run build` | คอมไพล์เป็น JavaScript ลง `dist/` |
| `npm start` | รันตัวที่คอมไพล์แล้ว (ใช้บน Render) |
| `npm run db:init` | สร้างตารางใหม่ทั้งหมดจาก `sql/schema.sql` |

## โครงสร้างไฟล์

```
project_Adweb-backend/
├── server.ts            เปิดพอร์ต
├── app.ts               CORS, JSON parser, ผูก router ใต้ /api, จัดการ error
├── dbconnect.ts         connection pool (ตั้ง time_zone เป็น +07:00 ให้ทุก connection)
├── config.ts            ค่าคงที่ทั้งระบบ (ราคา, รัศมี, เวลา, สีไรเดอร์)
├── controller/          config.ts, customers.ts, orders.ts
├── model/               interface + ตัวแปลง snake_case → camelCase + ตัวตรวจ body
├── lib/                 http.ts (รูปแบบ error กลาง), validate.ts, format.ts
├── service/distance.ts  haversine
├── scripts/init-db.ts   รัน sql/schema.sql
├── sql/schema.sql       CREATE TABLE ทั้งหมด + ลูกค้าตัวอย่าง
└── postman/             collection สำหรับทดสอบทุกเส้น
```

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

## ทดสอบด้วย Postman

Import ไฟล์ `postman/project_Adweb.postman_collection.json` แล้วแก้ตัวแปร `baseUrl` ของ collection
- ในเครื่อง: `http://localhost:3000/api`
- หลัง deploy: `https://<ชื่อ-service>.onrender.com/api`

## Deploy (HW-5 ข้อ 4)

ฐานข้อมูลใช้ **TiDB Cloud Starter** (ฟรี, ต่อแบบ MySQL) และ backend ขึ้น **Render**

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

### 3. Backend บน Render
1. [render.com](https://render.com) → New → **Web Service** → เลือก repo `project_Adweb-backend` แบบ Free
2. ตั้งค่า

| ช่อง | ค่า |
|---|---|
| Root Directory | (เว้นว่าง) |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |

3. Environment Variables: ใส่ `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` ค่าเดียวกับข้อ 2 และ `CORS_ORIGINS` (ช่วงแรกใส่ `*` ได้ พอ frontend deploy แล้วค่อยเปลี่ยนเป็น URL ของ frontend)
4. กด Deploy แล้วลองเปิด `https://<ชื่อ-service>.onrender.com/api/customers`

> [!NOTE]
> - Render แพ็กเกจฟรีจะหลับเมื่อไม่มีคนใช้ 15 นาที request แรกหลังหลับอาจใช้เวลาเกือบ 1 นาที ก่อนส่งงานให้เปิด URL ปลุกไว้ก่อน
> - TiDB บังคับเชื่อมต่อแบบ TLS ถ้าลืมใส่ `DB_SSL=true` จะเชื่อมต่อไม่ได้
> - TiDB ยังไม่รองรับฟังก์ชัน spatial (`ST_Distance_Sphere`, `POINT`) การคำนวณระยะจึงใช้ `haversineSql()` ใน `service/distance.ts` ห้ามเปลี่ยนกลับ
