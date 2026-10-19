import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config";
import { haversineKm, LatLng } from "../service/distance";
import { buildRoutes, PlanOrder, RoutingDeps } from "../service/routing";

/** ลูกค้าจำลองรอบร้านในรัศมีไม่เกิน ~2 กม. */
function makeOrders(n: number): PlanOrder[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = i * 2.399;
    const r = 0.003 + (i % 7) * 0.0017;
    return {
      orderId: 100 + i,
      customerId: i + 1,
      customerName: `ลูกค้า ${i + 1}`,
      phone: "0800000000",
      address: null,
      lat: config.shop.lat + Math.sin(angle) * r,
      lng: config.shop.lng + Math.cos(angle) * r,
      quantity: 1 + (i % 3),
    };
  });
}

/** OSRM ปลอม: ระยะถนน = เส้นตรง × 1.3 */
const fakeOsrm: RoutingDeps = {
  distanceTable: async (points: LatLng[]) => points.map((a) => points.map((b) => haversineKm(a, b) * 1.3)),
  path: async (points: LatLng[]) => points.map((p) => [p.lat, p.lng] as [number, number]),
};
/** OSRM ล่ม */
const offline: RoutingDeps = { distanceTable: async () => null, path: async () => null };

test("ทุกออเดอร์อยู่ในเส้นทางเดียวพอดี และไรเดอร์ถือไม่เกิน maxOrdersPerRider", async () => {
  const orders = makeOrders(25);
  const { routes } = await buildRoutes(orders, 42, fakeOsrm);
  const ids = routes.flatMap((r) => r.orderIds).sort((a, b) => a - b);
  assert.deepEqual(
    ids,
    orders.map((o) => o.orderId)
  );
  assert.equal(routes.length, Math.ceil(25 / config.delivery.maxOrdersPerRider));
  for (const r of routes) {
    assert.ok(r.stops.length <= config.delivery.maxOrdersPerRider);
    assert.deepEqual(
      r.stops.map((s) => s.seq),
      r.stops.map((_, i) => i + 1)
    );
    assert.deepEqual(
      r.orderIds,
      r.stops.map((s) => s.orderId)
    );
    assert.equal(
      r.totalBoxes,
      r.stops.reduce((s, x) => s + x.quantity, 0)
    );
    assert.equal(r.color, config.riderColors[(r.riderNo - 1) % config.riderColors.length]);
    assert.equal(r.cost.callFee, config.pricing.riderCallFee);
  }
});

test("seed เดิมได้ผลเดิมทุกครั้ง", async () => {
  const orders = makeOrders(20);
  const a = await buildRoutes(orders, 7, fakeOsrm);
  const b = await buildRoutes(orders, 7, fakeOsrm);
  assert.deepEqual(a, b);
});

test("seed ต่างกันได้แผนต่างกันได้ (ปุ่มคำนวณใหม่มีผล)", async () => {
  const orders = makeOrders(20);
  const shapes = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const { routes } = await buildRoutes(orders, seed, fakeOsrm);
    shapes.add(JSON.stringify(routes.map((r) => r.orderIds)));
  }
  assert.ok(shapes.size >= 2, `ได้แผนแบบเดียว ${shapes.size}`);
});

test("ทุก seed ได้แผนที่ค่าส่งแพงกว่าแผนดีที่สุดไม่เกิน alternativeTolerance", async () => {
  const orders = makeOrders(24);
  const costs: number[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { routes } = await buildRoutes(orders, seed, fakeOsrm);
    costs.push(routes.reduce((s, r) => s + r.cost.total, 0));
  }
  const best = Math.min(...costs);
  for (const c of costs) assert.ok(c <= best * (1 + config.routing.alternativeTolerance) + 0.05, `${c} vs ${best}`);
});

test("ลำดับในเส้นทางสั้นที่สุดจริง (เทียบทุกลำดับที่เป็นไปได้)", async () => {
  const orders = makeOrders(12);
  const { routes } = await buildRoutes(orders, 3, offline);
  for (const r of routes) {
    const pts = r.stops.map((s) => ({ lat: s.lat, lng: s.lng }));
    const len = (seq: LatLng[]) => {
      let d = 0;
      let prev: LatLng = config.shop;
      for (const p of seq) {
        d += haversineKm(prev, p);
        prev = p;
      }
      return d + (config.delivery.includeReturnTrip ? haversineKm(prev, config.shop) : 0);
    };
    const perms = (xs: LatLng[]): LatLng[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const best = Math.min(...perms(pts).map(len));
    assert.ok(Math.abs(len(pts) - best) < 1e-9, `ไรเดอร์ ${r.riderNo} ไม่ได้ลำดับที่สั้นที่สุด`);
  }
});

test("OSRM ใช้ไม่ได้ → ถอยไปใช้ haversine และเส้นแผนที่เป็นเส้นตรงต่อจุด", async () => {
  const orders = makeOrders(6);
  const { routes, distanceSource } = await buildRoutes(orders, 1, offline);
  assert.equal(distanceSource, "haversine");
  for (const r of routes) {
    assert.deepEqual(r.path[0], [config.shop.lat, config.shop.lng]);
    assert.equal(r.path.length, r.stops.length + 1 + (config.delivery.includeReturnTrip ? 1 : 0));
  }
});

test("OSRM ใช้ได้ → ระยะทางมาจากตารางถนน", async () => {
  const orders = makeOrders(6);
  const road = await buildRoutes(orders, 1, fakeOsrm);
  const straight = await buildRoutes(orders, 1, offline);
  assert.equal(road.distanceSource, "osrm");
  const total = (x: typeof road) => x.routes.reduce((s, r) => s + r.distanceKm, 0);
  assert.ok(total(road) > total(straight));
});

test("ETA และ finishTime ตามสูตรใน API.md", async () => {
  const { routes } = await buildRoutes(makeOrders(3), 1, offline);
  const r = routes[0];
  const { riderSpeedKmh, stopDurationMin } = config.delivery;
  r.stops.forEach((s, i) => {
    const minutes = (s.cumulativeDistanceKm / riderSpeedKmh) * 60 + i * stopDurationMin;
    const [h, m] = s.eta.split(":").map(Number);
    const etaMin = h * 60 + m - (11 * 60 + 30);
    assert.ok(etaMin >= minutes - 0.5 && etaMin <= minutes + 1, `eta ${s.eta} vs ${minutes}`);
  });
  assert.ok(r.finishTime >= r.stops[r.stops.length - 1].eta);
});

test("OSRM ค้างตอนขอเส้นบนแผนที่ → รอไม่เกิน geometryBudgetMs แล้วใช้เส้นตรง", async () => {
  const saved = config.routing.geometryBudgetMs;
  config.routing.geometryBudgetMs = 300;
  try {
    const hanging: RoutingDeps = {
      distanceTable: fakeOsrm.distanceTable,
      path: (_points, timeoutMs = 6000) => new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    };
    const started = Date.now();
    const { routes, distanceSource } = await buildRoutes(makeOrders(24), 1, hanging);
    assert.ok(Date.now() - started < 1500, `ใช้เวลา ${Date.now() - started} ms`);
    assert.equal(distanceSource, "osrm");
    for (const r of routes) assert.equal(r.path.length, r.stops.length + 1 + (config.delivery.includeReturnTrip ? 1 : 0));
  } finally {
    config.routing.geometryBudgetMs = saved;
  }
});

test("ไม่มีออเดอร์ → ไม่มีเส้นทาง", async () => {
  const { routes } = await buildRoutes([], 1, fakeOsrm);
  assert.deepEqual(routes, []);
});
