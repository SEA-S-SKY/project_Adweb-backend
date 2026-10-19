// จำลองไรเดอร์ทุกคนของวันหนึ่งวิ่งงานพร้อมกัน: เปิดงาน → ส่งตำแหน่ง GPS ระหว่างทาง → กดส่งสำเร็จทีละจุด
// แล้วตรวจว่าทุกจุดถูกบันทึกว่าส่งแล้วจริง (ย้ายมาจาก frontend เดิมยิง /api/shared ของ Cloudflare)
//
// รัน: npm run test:rider-workflow
//   RIDER_TEST_API      ฐาน URL ของ API (ค่าเริ่มต้น http://localhost:3000/api)
//   RIDER_TEST_DATE     วันที่ทดสอบ (ค่าเริ่มต้น 2099-12-31 แยกจากข้อมูลจริง)
//   RIDER_TEST_SETUP    1 = ถ้าวันนั้นยังไม่มีใบงาน ให้จำลองออเดอร์ → จัดเส้นทาง → ยืนยัน ให้เอง
//                       (เปิดอัตโนมัติเมื่อใช้วันที่ค่าเริ่มต้น)
//   RIDER_TEST_DELAY_MS หน่วงระหว่างส่งตำแหน่ง (ค่าเริ่มต้น 850)
//   RIDER_TEST_READS    จำนวน request อ่านต่อรอบในช่วงทดสอบอ่าน (ค่าเริ่มต้น 16)
// ⚠️ สคริปต์นี้กดส่งสำเร็จทุกจุดของวันที่เลือก อย่าใช้กับวันที่มีงานจริง
// ล้างข้อมูลหลังทดสอบ: npm run db:clear-date -- 2099-12-31
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_DATE = '2099-12-31';
const apiBase = (process.env.RIDER_TEST_API || 'http://localhost:3000/api').replace(/\/$/, '');
const date = process.env.RIDER_TEST_DATE || DEFAULT_DATE;
const setup = process.env.RIDER_TEST_SETUP === '1' || date === DEFAULT_DATE;
const sampleDelayMs = Number(process.env.RIDER_TEST_DELAY_MS || 850);
const readSamplesPerStage = Number(process.env.RIDER_TEST_READS || 16);
const outputDir = join(process.cwd(), 'output', 'load-tests');
const runId = `rider-load-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const requests = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

/** ยิง request (ลองซ้ำเมื่อ 429/5xx) คืน JSON · allow404 = คืน null แทน throw เมื่อไม่พบ */
async function request(path, init = {}, label = path, { allow404 = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    try {
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      const expected404 = allow404 && response.status === 404;
      requests.push({
        label,
        method: init.method || 'GET',
        status: response.status,
        ok: response.ok || expected404,
        attempt: attempt + 1,
        latencyMs: Number((performance.now() - started).toFixed(1)),
      });
      if (expected404) return null;
      if (response.ok) return body ? JSON.parse(body) : null;
      lastError = new Error(`${response.status} ${body.slice(0, 200)}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
      requests.push({
        label,
        method: init.method || 'GET',
        status: 0,
        ok: false,
        attempt: attempt + 1,
        latencyMs: Number((performance.now() - started).toFixed(1)),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(250 * 2 ** attempt);
  }
  throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function event(type, job, title, message, extra = {}) {
  return {
    id: `${runId}:${type}:${job.jobNo}:${crypto.randomUUID()}`.slice(0, 128),
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
    route: `/plan?date=${encodeURIComponent(date)}&rider=${job.riderNo}`,
    read: false,
    jobNo: job.jobNo,
    riderNo: job.riderNo,
    date,
    simulated: true,
    runId,
    ...extra,
  };
}

function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function closestPathIndex(path, stop, fromIndex) {
  let bestIndex = Math.min(fromIndex, path.length - 1);
  let bestDistance = Infinity;
  for (let index = bestIndex; index < path.length; index += 1) {
    const distance = haversine(path[index], [stop.lat, stop.lng]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** จุด GPS ระหว่างทางไปแต่ละจุดส่ง (ต้น กลาง ถึง) ตามเส้นทางในใบงาน */
function movementSamples(job) {
  const fallback = [[job.shop.lat, job.shop.lng], ...job.stops.map((stop) => [stop.lat, stop.lng])];
  const path = Array.isArray(job.path) && job.path.length > 1 ? job.path : fallback;
  let cursor = 0;
  return job.stops.map((stop) => {
    const arrival = closestPathIndex(path, stop, cursor);
    const midpoint = Math.max(cursor, Math.floor((cursor + arrival) / 2));
    const points = [path[cursor], path[midpoint], path[arrival]].filter(
      (point, index, list) => index === 0 || point[0] !== list[index - 1][0] || point[1] !== list[index - 1][1],
    );
    cursor = Math.min(arrival + 1, path.length - 1);
    return { stop, points };
  });
}

async function riderBot(job) {
  await request(
    '/events',
    { method: 'POST', body: JSON.stringify(event('rider-opened', job, `ไรเดอร์ ${job.riderNo} รับงานแล้ว`, `เปิดงาน ${job.jobNo}`)) },
    `open ${job.jobNo}`,
  );
  for (const { stop, points } of movementSamples(job)) {
    for (const point of points) {
      await request(
        '/events',
        {
          method: 'POST',
          body: JSON.stringify(
            event('rider-location', job, `ตำแหน่งไรเดอร์ ${job.riderNo}`, `กำลังเดินทางไปจุดที่ ${stop.seq}`, {
              lat: Number(point[0]),
              lng: Number(point[1]),
              accuracy: 8,
              source: 'gps',
            }),
          ),
        },
        `location ${job.jobNo}`,
      );
      await sleep(sampleDelayMs);
    }
    await request(
      `/jobs/${encodeURIComponent(job.jobNo)}/stops/${stop.seq}`,
      { method: 'PATCH', body: JSON.stringify({ delivered: true }) },
      `deliver ${job.jobNo}/${stop.seq}`,
    );
    await request(
      '/events',
      {
        method: 'POST',
        body: JSON.stringify(
          event(
            'delivery-completed',
            job,
            `ส่งสำเร็จ: ${stop.customerName}`,
            `ไรเดอร์ ${job.riderNo} ส่งจุดที่ ${stop.seq} ของงาน ${job.jobNo} แล้ว`,
          ),
        ),
      },
      `complete-event ${job.jobNo}/${stop.seq}`,
    );
  }
  return { jobNo: job.jobNo, riderNo: job.riderNo, delivered: job.stops.length };
}

async function readStage(concurrency) {
  let cursor = 0;
  const started = performance.now();
  async function worker() {
    while (cursor < readSamplesPerStage) {
      const index = cursor++;
      await request(`/jobs?date=${encodeURIComponent(date)}&sample=${index}`, {}, `read-c${concurrency}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { concurrency, requests: readSamplesPerStage, elapsedMs: Number((performance.now() - started).toFixed(1)) };
}

/** ใบงานเต็มของทุกคนในวันนั้น (GET /jobs ให้แค่สรุป ต้องเปิดทีละใบ) */
async function loadJobs(label) {
  const list = await request(`/jobs?date=${encodeURIComponent(date)}`, {}, label);
  return Promise.all(list.map((item) => request(`/jobs/${encodeURIComponent(item.jobNo)}`, {}, `${label} ${item.jobNo}`)));
}

/** สร้างใบงานทดสอบด้วย flow จริง: จำลองออเดอร์ → จัดเส้นทาง → ยืนยัน */
async function setupJobs() {
  console.log(`วันที่ ${date} ยังไม่มีใบงาน กำลังสร้างข้อมูลทดสอบ...`);
  await request('/orders/simulate', { method: 'POST', body: JSON.stringify({ orderDate: date, count: 12 }) }, 'setup simulate');
  const plan = await request('/plans', { method: 'POST', body: JSON.stringify({ date }) }, 'setup plan');
  await request(`/plans/${plan.id}/confirm`, { method: 'POST' }, 'setup confirm');
}

await mkdir(outputDir, { recursive: true });
let jobs = await loadJobs('initial jobs');
if (!jobs.length && setup) {
  await setupJobs();
  jobs = await loadJobs('initial jobs');
}
if (!jobs.length) throw new Error(`ไม่มีใบงานของวันที่ ${date} (ใส่ RIDER_TEST_SETUP=1 ให้สร้างข้อมูลทดสอบเอง)`);
const plan = await request(`/plans/latest?date=${encodeURIComponent(date)}`, {}, 'initial plan', { allow404: true });

const backupPath = join(outputDir, `${runId}-backup.json`);
await writeFile(backupPath, JSON.stringify({ backedUpAt: new Date().toISOString(), apiBase, date, plan, jobs }, null, 2));
console.log(`Backup: ${backupPath}`);
console.log(`Running ${jobs.length} rider bots for ${jobs.reduce((sum, job) => sum + job.stops.length, 0)} stops...`);

const readStages = [];
for (const concurrency of [1, 2, 4, 8]) readStages.push(await readStage(concurrency));

const workflowStarted = performance.now();
const bots = await Promise.all(jobs.map(riderBot));
const workflowElapsedMs = performance.now() - workflowStarted;
const verifiedJobs = await loadJobs('verify jobs');
const allStops = verifiedJobs.flatMap((job) => job.stops.map((stop) => ({ jobNo: job.jobNo, ...stop })));
const deliveredStops = allStops.filter((stop) => stop.delivered);
const failed = requests.filter((item) => !item.ok);
const successfulLatencies = requests.filter((item) => item.ok).map((item) => item.latencyMs);

const report = {
  runId,
  apiBase,
  date,
  startedWith: {
    jobs: jobs.length,
    stops: jobs.reduce((sum, job) => sum + job.stops.length, 0),
    delivered: jobs.flatMap((job) => job.stops).filter((stop) => stop.delivered).length,
  },
  controlledReadLoad: readStages,
  workflow: { concurrentRiders: jobs.length, elapsedMs: Number(workflowElapsedMs.toFixed(1)), bots },
  verification: {
    jobs: verifiedJobs.length,
    stops: allStops.length,
    delivered: deliveredStops.length,
    allDelivered: allStops.length > 0 && deliveredStops.length === allStops.length,
    notDelivered: allStops.filter((stop) => !stop.delivered).map((stop) => `${stop.jobNo}/${stop.seq}`),
  },
  http: {
    totalAttempts: requests.length,
    successfulAttempts: requests.length - failed.length,
    failedAttempts: failed.length,
    successRate: Number((((requests.length - failed.length) / requests.length) * 100).toFixed(2)),
    latencyMs: {
      mean: Number((successfulLatencies.reduce((sum, value) => sum + value, 0) / successfulLatencies.length).toFixed(1)),
      p50: Number(percentile(successfulLatencies, 0.5).toFixed(1)),
      p95: Number(percentile(successfulLatencies, 0.95).toFixed(1)),
      p99: Number(percentile(successfulLatencies, 0.99).toFixed(1)),
      max: Number(Math.max(...successfulLatencies).toFixed(1)),
    },
    failures: failed,
  },
  backupPath,
  cleanup: `npm run db:clear-date -- ${date}`,
  finishedAt: new Date().toISOString(),
};

const reportPath = join(outputDir, `${runId}-report.json`);
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
if (!report.verification.allDelivered || failed.length) process.exitCode = 1;
