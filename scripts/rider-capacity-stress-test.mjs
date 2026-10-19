// หาว่า API รับไรเดอร์ที่ใช้งานพร้อมกันได้กี่คน: เพิ่มจำนวนผู้ใช้ทีละขั้นจนกว่า error หรือ p95 เกินเกณฑ์
// ผู้ใช้จำลอง 1 คน = เปิดใบงาน → ส่ง event เปิดงาน → ส่งตำแหน่ง GPS → กดส่งสำเร็จ/ยกเลิก → ส่ง event → หน้าแอดมินดึง event
// (ย้ายมาจาก frontend เดิมสร้างใบงานปลอมผ่าน /api/shared/snapshot ซึ่ง backend ไม่มีแล้ว
//  ตอนนี้ใบงานต้องมาจากแผนจริง จึงสร้างชุดใบงานทดสอบครั้งเดียวแล้วให้ผู้ใช้จำลองหลายคนใช้ใบงานร่วมกัน)
//
// รัน: npm run test:rider-capacity
//   STRESS_API                 ฐาน URL ของ API (ค่าเริ่มต้น http://localhost:3000/api)
//   STRESS_DATE                วันที่ทดสอบแยกจากข้อมูลจริง (ค่าเริ่มต้น 2099-12-31)
//   STRESS_STAGES              จำนวนผู้ใช้พร้อมกันแต่ละขั้น (ค่าเริ่มต้น 8,16,32,64,128)
//   STRESS_ERROR_LIMIT         หยุดเมื่อ error rate ถึงค่านี้ (ค่าเริ่มต้น 0.01)
//   STRESS_P95_LIMIT_MS        หยุดเมื่อ p95 ถึงค่านี้ (ค่าเริ่มต้น 3000)
//   STRESS_REQUEST_TIMEOUT_MS  timeout ต่อ request (ค่าเริ่มต้น 10000)
// ⚠️ TiDB Cloud รุ่นฟรีมีโควตา Request Unit ต่อเดือน อย่ายิงขั้นใหญ่ ๆ บ่อย
// ล้างข้อมูลหลังทดสอบ: npm run db:clear-date -- 2099-12-31
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const api = (process.env.STRESS_API || 'http://localhost:3000/api').replace(/\/$/, '');
const testDate = process.env.STRESS_DATE || '2099-12-31';
const stages = (process.env.STRESS_STAGES || '8,16,32,64,128')
  .split(',')
  .map(Number)
  .filter((value) => Number.isFinite(value) && value > 0);
const errorLimit = Number(process.env.STRESS_ERROR_LIMIT || 0.01);
const p95LimitMs = Number(process.env.STRESS_P95_LIMIT_MS || 3000);
const timeoutMs = Number(process.env.STRESS_REQUEST_TIMEOUT_MS || 10000);
const outputDir = join(process.cwd(), 'output', 'load-tests');
const runId = `capacity-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function summarize(records, elapsedMs) {
  const failures = records.filter((record) => !record.ok);
  const timings = records.map((record) => record.latencyMs);
  const statusCounts = Object.fromEntries(
    [...new Set(records.map((record) => record.status))]
      .sort()
      .map((status) => [status, records.filter((record) => record.status === status).length]),
  );
  return {
    requests: records.length,
    successful: records.length - failures.length,
    failed: failures.length,
    errorRate: records.length ? Number((failures.length / records.length).toFixed(4)) : 0,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    requestsPerSecond: elapsedMs ? Number(((records.length / elapsedMs) * 1000).toFixed(1)) : 0,
    latencyMs: {
      mean: Number((timings.reduce((sum, value) => sum + value, 0) / Math.max(1, timings.length)).toFixed(1)),
      p50: Number(percentile(timings, 0.5).toFixed(1)),
      p95: Number(percentile(timings, 0.95).toFixed(1)),
      p99: Number(percentile(timings, 0.99).toFixed(1)),
      max: Number(Math.max(0, ...timings).toFixed(1)),
    },
    statusCounts,
    sampleFailures: failures.slice(0, 10),
  };
}

async function call(path, init, label, records) {
  const started = performance.now();
  try {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    records?.push({ label, status: response.status, ok: response.ok, latencyMs: Number((performance.now() - started).toFixed(1)) });
    return response.ok ? (text ? JSON.parse(text) : null) : null;
  } catch (error) {
    records?.push({
      label,
      status: 0,
      ok: false,
      latencyMs: Number((performance.now() - started).toFixed(1)),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function makeEvent(type, job, user, suffix, extra = {}) {
  return {
    id: `${runId}:${user}:${job.jobNo}:${type}:${suffix}`.slice(0, 128),
    type,
    title: `${type} ${job.jobNo}`,
    message: 'Synthetic capacity test',
    createdAt: new Date().toISOString(),
    route: `/rider/${job.jobNo}`,
    read: false,
    jobNo: job.jobNo,
    riderNo: job.riderNo,
    date: testDate,
    simulated: true,
    stressTest: true,
    runId,
    ...extra,
  };
}

/** ใบงานทดสอบของวันทดสอบ ถ้ายังไม่มีสร้างด้วย flow จริง (จำลองออเดอร์ → จัดเส้นทาง → ยืนยัน) */
async function prepareJobs() {
  let list = await call(`/jobs?date=${testDate}`, {}, 'setup list');
  if (!list?.length) {
    console.log(`สร้างใบงานทดสอบวันที่ ${testDate}...`);
    await call('/orders/simulate', { method: 'POST', body: JSON.stringify({ orderDate: testDate, count: 12 }) }, 'setup simulate');
    const plan = await call('/plans', { method: 'POST', body: JSON.stringify({ date: testDate }) }, 'setup plan');
    if (!plan) throw new Error('สร้างแผนทดสอบไม่สำเร็จ');
    await call(`/plans/${plan.id}/confirm`, { method: 'POST' }, 'setup confirm');
    list = await call(`/jobs?date=${testDate}`, {}, 'setup list');
  }
  const jobs = await Promise.all((list || []).map((item) => call(`/jobs/${item.jobNo}`, {}, 'setup job')));
  if (!jobs.length || jobs.some((job) => !job)) throw new Error('โหลดใบงานทดสอบไม่สำเร็จ');
  return jobs;
}

async function runUser(user, job, records) {
  const stop = job.stops[user % job.stops.length];
  const since = new Date(Date.now() - 60_000).toISOString();
  await call(`/jobs/${job.jobNo}`, {}, `open-job ${job.jobNo}`, records);
  await call('/events', { method: 'POST', body: JSON.stringify(makeEvent('rider-opened', job, user, 'open')) }, 'event open', records);
  await call(
    '/events',
    {
      method: 'POST',
      body: JSON.stringify(makeEvent('rider-location', job, user, 'gps', { lat: stop.lat, lng: stop.lng, accuracy: 8, source: 'gps' })),
    },
    'event gps',
    records,
  );
  // ผู้ใช้คู่กดส่งสำเร็จ คี่กดยกเลิก ให้ทั้งสองทางโดนทดสอบ
  await call(
    `/jobs/${job.jobNo}/stops/${stop.seq}`,
    { method: 'PATCH', body: JSON.stringify({ delivered: user % 2 === 0 }) },
    `deliver ${job.jobNo}/${stop.seq}`,
    records,
  );
  await call('/events', { method: 'POST', body: JSON.stringify(makeEvent('delivery-completed', job, user, 'done')) }, 'event done', records);
  await call(`/events?since=${encodeURIComponent(since)}`, {}, 'admin poll', records);
}

await mkdir(outputDir, { recursive: true });
const jobs = await prepareJobs();
console.log(`ใช้ใบงานทดสอบ ${jobs.length} ใบ: ${jobs.map((job) => job.jobNo).join(', ')}`);
const results = [];
let stopReason = 'maximum configured concurrency reached';

for (const users of stages) {
  const records = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: users }, (_, user) => runUser(user, jobs[user % jobs.length], records)));
  const result = { concurrentUsers: users, ...summarize(records, performance.now() - started) };
  results.push(result);
  console.log(JSON.stringify(result));

  if (result.errorRate >= errorLimit) {
    stopReason = `error rate ${(result.errorRate * 100).toFixed(2)}% reached the ${(errorLimit * 100).toFixed(2)}% cutoff`;
    break;
  }
  if (result.latencyMs.p95 >= p95LimitMs) {
    stopReason = `p95 ${result.latencyMs.p95} ms reached the ${p95LimitMs} ms cutoff`;
    break;
  }
  await sleep(750);
}

const stable = results.filter((result) => result.errorRate < errorLimit && result.latencyMs.p95 < p95LimitMs);
const report = {
  runId,
  api,
  isolatedTestDate: testDate,
  testJobs: jobs.map((job) => job.jobNo),
  policy: { errorLimit, p95LimitMs, requestTimeoutMs: timeoutMs },
  stopReason,
  highestStableConcurrentUsers: stable.at(-1)?.concurrentUsers || 0,
  firstUnstableConcurrentUsers:
    results.find((result) => result.errorRate >= errorLimit || result.latencyMs.p95 >= p95LimitMs)?.concurrentUsers || null,
  stages: results,
  cleanup: `npm run db:clear-date -- ${testDate}`,
  finishedAt: new Date().toISOString(),
};
const reportPath = join(outputDir, `${runId}-report.json`);
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
