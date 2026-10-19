// อัลกอริทึมจัดเส้นทางและแบ่งงานไรเดอร์ (ย้ายมาจาก frontend: demo-data.service.ts + road-routing.service.ts)
//
// 1. ตารางระยะทาง  ขอระยะตามถนนระหว่างทุกคู่จุด (ร้าน + ลูกค้าทุกคน) จาก OSRM ครั้งเดียว
//                  ถ้า OSRM ใช้ไม่ได้ใช้ haversine (เส้นตรง) แทน
// 2. กวาดตามมุม    เรียงลูกค้าตามมุมรอบร้าน (sweep) แล้วตัดเป็นกลุ่มละ maxOrdersPerRider คนที่อยู่ติดกัน
//                  ลองทุกจุดเริ่มและทั้งสองทิศ (ตามเข็ม/ทวนเข็ม) ได้แผนผู้สมัคร 2n แบบ
// 3. ลำดับในกลุ่ม  หาลำดับส่งที่สั้นที่สุดของแต่ละกลุ่ม (กลุ่มไม่เกิน 6 จุดลองครบทุกลำดับ มากกว่านั้นใช้ nearest-neighbor + 2-opt)
// 4. ให้คะแนน      คะแนน = ค่าส่งรวม + โทษหนักสำหรับจุดที่ส่งเกินเวลา แล้วเรียงจากดีไปแย่
// 5. เลือกด้วย seed seed เดียวกันได้แผนเดิมเสมอ · seed ต่างกันสุ่มเลือกจากแผนอันดับต้น ๆ (ไม่เกิน 5 แผน
//                  และแพงกว่าแผนที่ดีที่สุดไม่เกิน 3%) โอกาสได้แผนที่ดีที่สุดสูงสุด
//                  ปุ่ม "คำนวณใหม่" จึงได้แผนอื่นที่ยังดีพอ ๆ กัน ไม่ใช่แผนมั่ว ๆ
// 6. เส้นบนแผนที่  ขอเส้นทางตามถนนของแต่ละไรเดอร์จาก OSRM ไว้วาดบน Leaflet ถ้าไม่ได้ใช้เส้นตรงต่อจุด

import { config } from "../config";
import { addMinutes, round2 } from "../lib/format";
import { DistanceSource, LatLngTuple, Route, RouteStop } from "../model/plan";
import { calculateRouteCost } from "./costing";
import { haversineKm, LatLng } from "./distance";
import { osrmDistanceTable, osrmPath } from "./osrm";

/** ออเดอร์ pending 1 รายการพร้อมข้อมูลลูกค้า (อินพุตของอัลกอริทึม) */
export interface PlanOrder {
  orderId: number;
  customerId: number;
  customerName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  quantity: number;
}

/** แยกส่วนที่เรียกเครือข่ายออกมา เพื่อให้ test ใส่ตัวปลอมได้ */
export interface RoutingDeps {
  distanceTable: (points: LatLng[]) => Promise<(number | null)[][] | null>;
  path: (points: LatLng[], timeoutMs?: number) => Promise<LatLngTuple[] | null>;
}

const defaultDeps: RoutingDeps = { distanceTable: osrmDistanceTable, path: osrmPath };

const LATE_PENALTY = 1000; // บาทสมมติต่อจุดที่ส่งเกินเวลา ให้แผนที่ส่งทันเวลาชนะเสมอ
const TOP_CHOICES = 5;

export interface RoutingResult {
  routes: Route[];
  distanceSource: DistanceSource;
}

export async function buildRoutes(
  orders: PlanOrder[],
  seed: number,
  deps: RoutingDeps = defaultDeps
): Promise<RoutingResult> {
  if (!orders.length) return { routes: [], distanceSource: "haversine" };

  const shop = config.shop;
  const points: LatLng[] = [shop, ...orders]; // index 0 = ร้าน, index i = orders[i - 1]
  const { km, source } = await distanceMatrix(points, deps);

  const best = chooseGrouping(orders, km, seed);
  const routes = best.map((order, i) => buildRoute(i + 1, order.map((idx) => orders[idx - 1]), order, km));

  // เส้นทางตามถนนไว้วาดแผนที่ (ระยะ/เงินคิดจากตารางระยะทางไปแล้ว ส่วนนี้แค่หน้าตาเส้น)
  // ให้เวลารวมไม่เกิน geometryBudgetMs เส้นไหนขอไม่ทันใช้เส้นตรงต่อจุดไปก่อน
  if (source === "osrm") {
    const deadline = Date.now() + config.routing.geometryBudgetMs;
    await mapLimit(routes, config.routing.geometryConcurrency, async (route) => {
      const remaining = Math.min(config.routing.timeoutMs, deadline - Date.now());
      if (remaining <= 0) return;
      const path = await deps.path(
        route.path.map(([lat, lng]) => ({ lat, lng })),
        remaining
      );
      if (path) route.path = path;
    });
  }
  return { routes, distanceSource: source };
}

// ---------------------------------------------------------------------------
// 1. ตารางระยะทาง
// ---------------------------------------------------------------------------

async function distanceMatrix(points: LatLng[], deps: RoutingDeps) {
  const straight = points.map((a) => points.map((b) => haversineKm(a, b)));
  if (config.delivery.distanceMethod !== "osrm") return { km: straight, source: "haversine" as const };

  const road = await deps.distanceTable(points);
  if (!road) return { km: straight, source: "haversine" as const };
  // คู่ไหน OSRM หาเส้นทางไม่เจอ ใช้เส้นตรงแทนเฉพาะคู่นั้น
  const km = road.map((row, i) => row.map((d, j) => (d ?? straight[i][j])));
  return { km, source: "osrm" as const };
}

// ---------------------------------------------------------------------------
// 2–5. แบ่งกลุ่ม + เรียงลำดับ + ให้คะแนน + เลือกด้วย seed
// ---------------------------------------------------------------------------

/** คืนรายการกลุ่ม แต่ละกลุ่มเป็น index ของจุด (1..n) เรียงตามลำดับส่งแล้ว */
export function chooseGrouping(orders: PlanOrder[], km: number[][], seed: number): number[][] {
  const size = config.delivery.maxOrdersPerRider;
  const ring = sweepOrder(orders);
  const n = ring.length;

  const seen = new Set<string>();
  const candidates: { groups: number[][]; score: number; key: string }[] = [];
  for (const direction of [ring, [...ring].reverse()]) {
    for (let start = 0; start < n; start++) {
      const rotated = [...direction.slice(start), ...direction.slice(0, start)];
      const groups: number[][] = [];
      for (let i = 0; i < n; i += size) groups.push(bestStopOrder(rotated.slice(i, i + size), km));
      // แผนเดียวกันที่ได้จากจุดเริ่มต่างกันนับเป็นแผนเดียว
      const key = groups
        .map((g) => [...g].sort((a, b) => a - b).join(","))
        .sort()
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ groups, key, score: groups.reduce((s, g) => s + routeScore(g, orders, km), 0) });
    }
  }
  // เรียงจากคะแนนดีสุด ถ้าเท่ากันเรียงตาม key เพื่อให้ผลคงที่
  candidates.sort((a, b) => a.score - b.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // ตัวเลือกให้ seed สุ่ม: ไม่เกิน 5 แผนแรก และแพงกว่าแผนที่ดีที่สุดไม่เกิน alternativeTolerance
  const limit = candidates[0].score * (1 + config.routing.alternativeTolerance) + 1e-9;
  const top = Math.max(1, candidates.slice(0, TOP_CHOICES).filter((c) => c.score <= limit).length);
  const rng = mulberry32(seed);
  const pick = Math.floor(rng() ** 2 * top); // ยกกำลังสอง = เอนไปทางแผนที่ดีกว่า
  return candidates[pick].groups;
}

/** เรียง index ของลูกค้า (1..n) ตามมุมรอบร้าน แล้วหมุนให้เริ่มหลังช่องว่างที่กว้างที่สุด */
function sweepOrder(orders: PlanOrder[]): number[] {
  const shop = config.shop;
  const circle = orders
    .map((o, i) => {
      const a = Math.atan2(o.lat - shop.lat, o.lng - shop.lng);
      return { idx: i + 1, angle: a < 0 ? a + 2 * Math.PI : a };
    })
    .sort((a, b) => a.angle - b.angle || a.idx - b.idx);
  let start = 0;
  let widest = -1;
  for (let i = 0; i < circle.length; i++) {
    const next = i === circle.length - 1 ? circle[0].angle + 2 * Math.PI : circle[i + 1].angle;
    if (next - circle[i].angle > widest) {
      widest = next - circle[i].angle;
      start = (i + 1) % circle.length;
    }
  }
  return [...circle.slice(start), ...circle.slice(0, start)].map((c) => c.idx);
}

/** ระยะวิ่งของลำดับนี้ (เริ่มที่ร้าน และรวมขากลับถ้าตั้งค่าไว้) */
function tourKm(seq: number[], km: number[][]): number {
  let total = 0;
  let prev = 0;
  for (const idx of seq) {
    total += km[prev][idx];
    prev = idx;
  }
  if (config.delivery.includeReturnTrip && seq.length) total += km[prev][0];
  return total;
}

/** ลำดับส่งที่สั้นที่สุดของกลุ่ม */
function bestStopOrder(group: number[], km: number[][]): number[] {
  if (group.length < 2) return [...group];
  if (group.length <= 6) {
    let best = group;
    let bestKm = Infinity;
    for (const p of permutations(group)) {
      const d = tourKm(p, km);
      if (d < bestKm - 1e-9) {
        best = p;
        bestKm = d;
      }
    }
    return best;
  }
  // กลุ่มใหญ่ (ถ้าวันหนึ่งเพิ่ม maxOrdersPerRider): nearest-neighbor แล้วปรับด้วย 2-opt
  const remaining = [...group];
  const order: number[] = [];
  let current = 0;
  while (remaining.length) {
    let nearest = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (km[current][remaining[i]] < km[current][remaining[nearest]]) nearest = i;
    }
    current = remaining.splice(nearest, 1)[0];
    order.push(current);
  }
  let best = order;
  let bestKm = tourKm(best, km);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const d = tourKm(candidate, km);
        if (d + 1e-3 < bestKm) {
          best = candidate;
          bestKm = d;
          improved = true;
        }
      }
    }
  }
  return best;
}

function* permutations(items: number[]): Generator<number[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}

/** คะแนนของไรเดอร์ 1 คน = ค่าส่ง + โทษจุดที่เกินเวลา (ยิ่งน้อยยิ่งดี) */
function routeScore(seq: number[], orders: PlanOrder[], km: number[][]): number {
  const boxes = seq.reduce((s, idx) => s + orders[idx - 1].quantity, 0);
  const cost = calculateRouteCost(boxes, tourKm(seq, km)).total;
  const { departTime, deadline, riderSpeedKmh, stopDurationMin } = config.delivery;
  let late = 0;
  let cumulative = 0;
  let prev = 0;
  seq.forEach((idx, i) => {
    cumulative += km[prev][idx];
    prev = idx;
    if (addMinutes(departTime, (cumulative / riderSpeedKmh) * 60 + i * stopDurationMin) > deadline) late++;
  });
  return cost + late * LATE_PENALTY;
}

// ---------------------------------------------------------------------------
// สร้าง Route object ตาม API.md
// ---------------------------------------------------------------------------

function buildRoute(riderNo: number, orders: PlanOrder[], seq: number[], km: number[][]): Route {
  const { departTime, deadline, riderSpeedKmh, stopDurationMin, includeReturnTrip } = config.delivery;
  const shop = config.shop;
  let cumulative = 0;
  let prev = 0;
  const stops: RouteStop[] = orders.map((o, i) => {
    const leg = km[prev][seq[i]];
    cumulative += leg;
    prev = seq[i];
    const eta = addMinutes(departTime, (cumulative / riderSpeedKmh) * 60 + i * stopDurationMin);
    return {
      seq: i + 1,
      orderId: o.orderId,
      customerId: o.customerId,
      customerName: o.customerName,
      phone: o.phone,
      address: o.address,
      lat: o.lat,
      lng: o.lng,
      quantity: o.quantity,
      legDistanceKm: round2(leg),
      cumulativeDistanceKm: round2(cumulative),
      eta,
      onTime: eta <= deadline,
    };
  });
  const distance = tourKm(seq, km);
  const totalBoxes = orders.reduce((s, o) => s + o.quantity, 0);
  const durationMin = (distance / riderSpeedKmh) * 60 + stops.length * stopDurationMin;
  const shopPoint: LatLngTuple = [shop.lat, shop.lng];
  return {
    riderNo,
    color: config.riderColors[(riderNo - 1) % config.riderColors.length],
    jobNo: null,
    orderIds: orders.map((o) => o.orderId),
    totalBoxes,
    distanceKm: round2(distance),
    durationMin: round2(durationMin),
    departTime,
    finishTime: addMinutes(departTime, durationMin),
    onTime: stops.every((s) => s.onTime),
    cost: calculateRouteCost(totalBoxes, distance),
    stops,
    path: [shopPoint, ...stops.map((s) => [s.lat, s.lng] as LatLngTuple), ...(includeReturnTrip ? [shopPoint] : [])],
  };
}

// ---------------------------------------------------------------------------
// เครื่องมือเล็ก ๆ
// ---------------------------------------------------------------------------

/** ตัวสุ่มที่กำหนด seed ได้ (mulberry32) seed เดิมได้ลำดับเลขสุ่มเดิมเสมอ */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ทำงานกับทุกตัวใน items โดยรันพร้อมกันไม่เกิน limit งาน */
async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) await work(items[cursor++]);
  });
  await Promise.all(workers);
}
