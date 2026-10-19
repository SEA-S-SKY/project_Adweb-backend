# สิ่งที่ฝั่ง frontend ต้องแก้ หลังย้าย backend ออกจาก frontend

อ้างอิง frontend `advand-web-font-end` (Angular 21) · รายละเอียด API ใหม่อยู่ใน [PLANS_JOBS_EVENTS.md](PLANS_JOBS_EVENTS.md)

## สรุปสั้น ๆ

ใน frontend มี backend ซ่อนอยู่ 2 ส่วน ตอนนี้ย้ายไปไว้ที่ `project_Adweb-backend` หมดแล้ว

1. **Cloudflare Worker + D1** (`public/_worker.js`, `cloudflare/schema.sql`) = API `/api/shared/*` และฐานข้อมูลอีกตัวแยกจาก TiDB
   → ใช้ `/api/plans`, `/api/jobs`, `/api/events` ของ backend แทน ข้อมูลอยู่ใน TiDB ที่เดียว
2. **อัลกอริทึมจัดเส้นทาง + คิดเงิน** ที่รันใน browser (`demo-data.service.ts`, `road-routing.service.ts`)
   → backend คำนวณให้ใน `POST /api/plans` ส่งกลับมาเป็นระยะตามถนน เส้นบนแผนที่ และตัวเลขเงินครบแล้ว

หน้าจอแทบไม่ต้องเปลี่ยน เพราะ `backend-api.service.ts` มีฟังก์ชันเรียก `/plans` `/jobs` ตาม API.md อยู่แล้ว (แค่ปิดไว้ด้วย `APP_REMOTE_PLANNING=false`)

> [!IMPORTANT]
> **ลำดับ:** merge PR ของ backend และให้ Vercel deploy เสร็จก่อน แล้วค่อย deploy frontend ที่แก้แล้ว
> ตาราง `events` ใน TiDB สร้างไว้แล้ว ส่วน CORS ของ backend เปิด `*` อยู่แล้ว (เช็กเมื่อ 2026-10-20)

---

## 1. ลบไฟล์ที่เป็น backend

| ไฟล์ | ทำอะไร |
|---|---|
| `public/_worker.js` | ลบ (Pages จะกลับไปเสิร์ฟไฟล์ static + `_redirects` ตามปกติ) |
| `cloudflare/schema.sql` | ลบทั้งโฟลเดอร์ |
| `wrangler.jsonc` | ลบก้อน `d1_databases` เก็บไว้แค่ `name`, `compatibility_date`, `pages_build_output_dir` |
| `SHARED_DELIVERY_API.md` | ลบ (เนื้อหาย้ายไปที่ backend `docs/PLANS_JOBS_EVENTS.md`) |
| `scripts/rider-workflow-load-test.mjs`, `scripts/rider-capacity-stress-test.mjs` | ลบ (ย้ายไป backend แล้ว) และลบ `test:rider-workflow`, `test:rider-capacity` ใน `package.json` |

หลัง deploy ใหม่เรียบร้อย ลบฐานข้อมูล D1 `msu-lunchbox-delivery` ใน Cloudflare dashboard ได้ (ไม่บังคับ)

## 2. ค่าตั้ง (`.env`, runtime config)

ตอนนี้ไม่มีโหมด "วางแผนในเครื่อง" แล้ว จึงเอา flag ออกได้เลย

- `.env.example`, `scripts/generate-runtime-config.mjs`: ลบ `APP_REMOTE_PLANNING`, `APP_REMOTE_SHARED_STATE`, `APP_SHARED_API_URL`
- `runtime-config.service.ts`: ลบ `remotePlanning`, `remoteSharedState`, `sharedApiUrl` และ field `features`, `sharedApiUrl` ใน `RuntimeConfig`
- Environment Variables ของ Cloudflare Pages: ลบ 3 ตัวด้านบน

> ถ้ายังไม่อยากรื้อทั้งหมดในรอบเดียว ตั้ง `APP_REMOTE_PLANNING=true` และ `APP_REMOTE_SHARED_STATE=false` ก็ใช้ backend ได้ทันที แต่โค้ดคำนวณในเครื่องจะยังค้างอยู่ ควรทำข้อ 4–6 ตามมา

## 3. `backend-api.service.ts`

**3.1 เพิ่ม timeout ให้การจัดเส้นทาง** ตอนนี้ทุก request ตัดที่ 4 วินาที แต่ `POST /api/plans` เรียก OSRM ด้วย ใช้เวลาปกติ 1–2 วินาที ถ้า Vercel cold start หรือ OSRM ช้าอาจถึง ~11 วินาที

```ts
createPlan(date: string, seed?: number): Promise<Plan> {
  return this.post<Plan>('/plans', { date, ...(seed === undefined ? {} : { seed }) }, 20_000);
}
confirmPlan(id: number): Promise<Plan> {
  return this.post<Plan>(`/plans/${id}/confirm`, {}, 20_000);
}

private post<T>(path: string, body: unknown, timeoutMs = 4000): Promise<T> {
  return this.request(this.http.post<T>(`${this.baseUrl}${path}`, body), timeoutMs);
}
private async request<T>(source: Observable<T>, timeoutMs = 4000): Promise<T> {
  try {
    return (await firstValueFrom(source.pipe(timeout(timeoutMs)))) as T;
  } // ... ส่วน catch เหมือนเดิม
}
```

**3.2 เพิ่ม events** (import แบบ `import type { SharedEvent } from './shared-delivery.service'` จะได้ไม่ import วนกัน)

```ts
events(since: string): Promise<SharedEvent[]> {
  return this.get<SharedEvent[]>('/events', new HttpParams().set('since', since));
}
postEvent(event: SharedEvent): Promise<{ ok: true }> {
  return this.post<{ ok: true }>('/events', event);
}
```

## 4. `shared-delivery.service.ts` → เหลือแค่ events

`notification.service.ts` และ `rider-tracking.service.ts` เรียกแค่ `publishEvent()` กับ `events()` ถ้าเก็บชื่อคลาสเดิมไว้ 2 ไฟล์นั้นไม่ต้องแก้

```ts
@Injectable({ providedIn: 'root' })
export class SharedDeliveryService {
  private readonly api = inject(BackendApiService);

  async publishEvent(event: SharedEvent): Promise<void> {
    try {
      await this.api.postEvent(event);
    } catch {
      // แจ้งเตือนในเครื่องยังทำงานได้ ถ้าส่งขึ้น backend ไม่สำเร็จ
    }
  }

  async events(since: string): Promise<SharedEvent[]> {
    try {
      return await this.api.events(since);
    } catch {
      return [];
    }
  }
}
```

ลบ `saveSnapshot`, `dateState`, `latestPlan`, `jobs`, `job`, `jobState`, `updateStop`, `request` และ getter `enabled` ออก (ถ้ามีที่ไหนเช็ก `shared.enabled` ให้ถือว่าเป็น `true`)

## 5. `demo-data.service.ts` — เอาอัลกอริทึมออก ให้เรียก backend ตรง ๆ

**ลบทิ้ง** (ย้ายไป backend `service/routing.ts` และ `service/costing.ts` แล้ว)
`createPlan()`, `buildRoute()`, `rotateAtLargestAngularGap()`, `optimizeStopOrder()`, `routeDistance()`, `rebuildPlanSummary()`, `confirmPlan()`, `setDelivered()`, `googleMapsRoute()`, `refreshSharedDate()`, `angle()` และฟังก์ชันท้ายไฟล์ `dateSuffix()`, `normalizeAngle()` (`addMinutes()` ลบได้ถ้าไม่มีที่อื่นใช้)

**แก้ให้เรียก backend เสมอ**

```ts
async createPlanApi(date: string): Promise<Plan> {
  await this.apiReady;
  this.assertNotPastDeliveryDate(date);
  this.assertOnline();
  const plan = await this.api.createPlan(date);
  this.plans.update((items) => [...items.filter((p) => p.date !== date || p.status === 'confirmed'), plan]);
  this.persist();
  return plan;
}

async confirmPlanApi(planId: number): Promise<Plan> {
  await this.apiReady;
  this.assertOnline();
  const plan = await this.api.confirmPlan(planId); // 409 PLAN_OUTDATED → throw Error พร้อมข้อความจาก backend
  this.plans.update((items) => items.map((p) => (p.id === planId ? plan : p)));
  await this.refreshDate(plan.date); // ดึงใบงานและสถานะออเดอร์ใหม่
  return plan;
}

// หน้าไรเดอร์: เรียก backend ตรง ๆ ไม่ต้องรอ connectBackend() (constructor ข้ามไว้สำหรับ /rider)
async loadJobApi(jobNo: string): Promise<Job | null> {
  try {
    const job = await this.api.job(jobNo.trim());
    this.mergeJob(job);
    return job;
  } catch {
    return null; // 404 = ไม่พบใบงาน
  }
}

async setDeliveredApi(jobNo: string, seq: number, delivered: boolean): Promise<Job | null> {
  const job = await this.api.updateJobStop(jobNo, seq, delivered);
  this.mergeJob(job);
  this.applyJobStatuses(job);
  this.persist();
  return job;
}

private assertOnline(): void {
  if (this.backendStatus() !== 'online') throw new Error('เชื่อมต่อ backend ไม่ได้ จัดเส้นทางหรือยืนยันแผนไม่ได้ในตอนนี้');
}
```

**จุดอื่นในไฟล์เดียวกัน**

- `refreshDate()`: เอา `if (this.runtime.remotePlanning)` ออก ให้ดึง `latestPlan` + `jobs` ทุกครั้ง และลบบรรทัด `await this.refreshSharedDate(date)`
- `deleteOrderApi()` / `reconcileDeletedOrder()`: ลบการคำนวณแผนใหม่ในเครื่องทิ้ง backend ไม่ยอมลบออเดอร์ที่ยืนยันแล้ว (`409 ORDER_LOCKED`) ส่วนออเดอร์ที่อยู่ในแผน draft ถ้าถูกลบหรือแก้จำนวนกล่อง ตอนกดยืนยันจะได้ `409 PLAN_OUTDATED` ทางเลือกที่ง่ายสุดคือหลังลบหรือแก้ออเดอร์ให้เรียก `createPlanApi(date)` ใหม่ หรือขึ้นข้อความ "ออเดอร์เปลี่ยน กดคำนวณใหม่"
- `mode` (computed): เหลือแค่ `'เชื่อมต่อ API แล้ว'` / `'กำลังเชื่อมต่อ API'` / `'ข้อมูลสำรองในเครื่อง'`
- ลูกค้าและออเดอร์แบบ offline fallback (`saveCustomer`, `simulateOrders` ฯลฯ) จะเก็บไว้ก็ได้ เพราะไม่ใช่อัลกอริทึม แต่ถ้า offline จะจัดเส้นทางไม่ได้แล้ว

## 6. `road-routing.service.ts` — เหลือแค่ตัวช่วยวาดแผนที่

**ลบ** `enrich()`, `enrichRoute()`, `recalculate()`, `readCache()`, `writeCache()`, `cacheKey`, interface `CachedRoute`, `OsrmTripResponse` และ `round()`, `addMinutes()` ท้ายไฟล์ (ถ้าไม่มีที่อื่นใช้)
backend ใช้ OSRM คำนวณระยะ จัดลำดับ และส่ง `path` ตามถนนมาให้แล้ว ถ้ายังคำนวณซ้ำในเครื่อง ตัวเลขบนจอจะไม่ตรงกับที่บันทึกในฐานข้อมูล

**เก็บไว้** `snapToRoad()`, `snapManyToRoad()` (ปรับหมุดลูกค้าเข้าถนนในหน้า customers) และ `pathFor()` (หน้าไรเดอร์วาดเส้นจากตำแหน่ง GPS ปัจจุบันไปจุดถัดไป) เพราะเป็นงานแสดงผลบนแผนที่

## 7. `plan.component.ts` / `.html`

- ลบ `enrichRoads()` และที่เรียกมันทั้ง 3 จุด (ตอนเปิดหน้า, `changeDate()`, `calculate()`)
- `roadStatus` เปลี่ยนเป็นค่าจากแผน

  ```ts
  readonly roadStatus = computed(() =>
    this.plan()?.distanceSource === 'osrm' ? 'ready' : 'fallback',
  );
  ```

  ใน template ยังใช้ `roadStatus()` ได้เหมือนเดิม (สถานะ `'loading'` ไม่มีแล้ว ปุ่มที่ `[disabled]="roadStatus() === 'loading'"` ลบเงื่อนไขนั้นออกได้)
- `confirm()`: ครอบ `try/catch` แล้ว `this.error.set((error as Error).message)` เพราะยืนยันอาจได้ `409 PLAN_OUTDATED` (ข้อความจาก backend บอกให้กดคำนวณใหม่อยู่แล้ว)
- flow "มีออเดอร์ใหม่หลังยืนยัน ต้องกดคำนวณใหม่" (`needsNewPlan`) ใช้ได้เลย backend รองรับการยืนยันรอบที่ 2 ของวันเดียวกัน และเลขใบงานต่อจากเดิม

## 8. `models/api.models.ts`

```ts
export type ApiErrorCode = /* ...เดิม */ | 'PLAN_OUTDATED';

export interface Plan {
  // ...เดิม
  /** 'osrm' = ระยะตามถนน · 'haversine' = OSRM ใช้ไม่ได้ ระยะเป็นเส้นตรง */
  distanceSource: 'osrm' | 'haversine';
}

export interface JobListItem {
  // ...เดิม
  deliveredCount: number; // ไม่ optional แล้ว
}

export interface Job {
  // ...เดิม
  path: LatLng[]; // มีเสมอ
}
```

`JobStop.orderId`, `customerId`, `deliveredAt` ส่งมาทุกครั้งแล้ว เปลี่ยนเป็นไม่ optional ได้

## 9. เอกสารใน repo frontend

- `API.md` หัวข้อ 4–5: เพิ่มจุดที่มีเครื่องหมาย 🆕 ใน backend `docs/PLANS_JOBS_EVENTS.md` (`distanceSource`, `PLAN_OUTDATED`, ยืนยันได้หลายรอบต่อวัน, `deliveredCount`, `path`) และเพิ่มหัวข้อ Events
- `API.md` ตารางค่าคงที่: `distanceMethod` ตอนนี้เป็น `osrm` (⚠️ ข้อ 4 ยังเปลี่ยนกลับได้ที่ backend `config.ts`)
- ER Diagram (`docs/er-diagram.*`): เพิ่มตาราง `events` (ไม่มี foreign key)
- `DATA_SOURCE_AUDIT.md`, `README.md`, `FRONTEND.md`, `TASKS.md`: เอาเรื่อง Cloudflare D1 / `/api/shared` / "แผนในเครื่อง" ออก

## 10. เช็กหลังแก้

1. หน้าออเดอร์: จำลองออเดอร์ → หน้า plan กด "จัดเส้นทาง" → เห็นเส้นตามถนน และสถานะเส้นทางขึ้นว่าใช้ถนนจริง
2. กด "คำนวณใหม่" ได้แผนใหม่ (บางวันอาจได้แผนเดิม ถ้าแผนที่ดีที่สุดถูกกว่าแผนอื่นเกิน 3%)
3. กด "ยืนยัน" → ได้เลขใบงาน `MMDD-NN` และ QR
4. เปิด `/rider/<เลขใบงาน>` **บนมือถืออีกเครื่อง** → เห็นใบงาน กด "ส่งแล้ว" → หน้าแอดมินขึ้นแจ้งเตือน และออเดอร์เป็น `delivered`
5. เพิ่มออเดอร์หลังยืนยัน → คำนวณใหม่ → ยืนยันรอบสอง → เลขใบงานต่อจากเดิม
6. เปิด DevTools แท็บ Network ต้องไม่มี request ไปที่ `/api/shared` อีก
7. แก้จำนวนกล่องของออเดอร์ที่อยู่ใน draft แล้วกดยืนยัน → ต้องขึ้นข้อความให้คำนวณใหม่ (ไม่ใช่หน้าค้าง)
