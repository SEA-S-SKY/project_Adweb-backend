import assert from "node:assert/strict";
import { test } from "node:test";
import { addMinutes } from "../lib/format";
import { Route } from "../model/plan";
import { calculatePlanSummary, calculateRouteCost, planWarnings } from "../service/costing";

test("ตัวอย่างจากโจทย์: 6 กล่อง วิ่ง 2 กม. = 15 + 24 = 39 บาท", () => {
  assert.deepEqual(calculateRouteCost(6, 2), { callFee: 15, distanceFee: 24, total: 39 });
});

test("ค่าระยะทางปัดทศนิยม 2 ตำแหน่ง", () => {
  assert.deepEqual(calculateRouteCost(3, 1.234), { callFee: 15, distanceFee: 7.4, total: 22.4 });
});

function route(riderNo: number, boxes: number, km: number, finish: string, onTime = true): Route {
  return {
    riderNo,
    color: "#000000",
    jobNo: null,
    orderIds: [riderNo],
    totalBoxes: boxes,
    distanceKm: km,
    durationMin: 0,
    departTime: "11:30",
    finishTime: finish,
    onTime,
    cost: calculateRouteCost(boxes, km),
    stops: [
      {
        seq: 1,
        orderId: riderNo,
        customerId: riderNo,
        customerName: "ทดสอบ",
        phone: "0800000000",
        address: null,
        lat: 0,
        lng: 0,
        quantity: boxes,
        legDistanceKm: km,
        cumulativeDistanceKm: km,
        eta: finish,
        onTime,
      },
    ],
    path: [],
  };
}

test("สรุปแผน: รายได้ ต้นทุนอาหาร ค่าส่ง และกำไรสุทธิ", () => {
  const s = calculatePlanSummary([route(1, 6, 2, "11:40"), route(2, 3, 1, "11:50")]);
  assert.equal(s.totalBoxes, 9);
  assert.equal(s.revenue, 585); // 65 × 9
  assert.equal(s.foodCost, 360); // 40 × 9
  assert.equal(s.grossProfit, 225);
  assert.equal(s.riderCallFees, 30);
  assert.equal(s.distanceFees, 30); // 24 + 6
  assert.equal(s.deliveryCost, 60);
  assert.equal(s.netProfit, 165);
  assert.equal(s.isProfitable, true);
  assert.equal(s.lastFinishTime, "11:50");
  assert.equal(s.riderCount, 2);
  assert.equal(s.orderCount, 2);
});

test("เตือนเมื่อส่งเกินเวลาและเมื่อขาดทุน", () => {
  const routes = [route(1, 1, 30, "12:45", false)];
  routes[0].stops[0].eta = "12:45";
  const s = calculatePlanSummary(routes);
  const w = planWarnings(routes, s);
  assert.deepEqual(
    w.map((x) => x.code),
    ["LATE_DELIVERY", "NOT_PROFITABLE"]
  );
  assert.equal(w[0].riderNo, 1);
});

test("addMinutes ปัดนาทีขึ้น", () => {
  assert.equal(addMinutes("11:30", 0), "11:30");
  assert.equal(addMinutes("11:30", 13.2), "11:44");
  assert.equal(addMinutes("11:30", 30), "12:00");
  assert.equal(addMinutes("11:59", 1.5), "12:01");
});
