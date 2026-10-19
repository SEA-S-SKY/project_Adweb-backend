// โมดูลคำนวณต้นทุน (API.md หัวข้อ 6) — ใช้สูตรเดียวกันทั้งระบบ
import { config } from "../config";
import { round2 } from "../lib/format";
import { PlanSummary, PlanWarning, Route, RouteCost } from "../model/plan";

/** ค่าส่งของไรเดอร์ 1 คน: totalBoxes = กล่องที่ถือออกจากร้าน, distanceKm = ระยะทั้งรอบ */
export function calculateRouteCost(totalBoxes: number, distanceKm: number): RouteCost {
  const { riderCallFee, distanceFeePerKmPerBox } = config.pricing;
  const distanceFee = round2(distanceFeePerKmPerBox * totalBoxes * distanceKm);
  return { callFee: riderCallFee, distanceFee, total: round2(riderCallFee + distanceFee) };
}

/** สรุปภาพรวมของทั้งแผน */
export function calculatePlanSummary(routes: Route[]): PlanSummary {
  const { pricePerBox, foodCostPerBox } = config.pricing;
  const totalBoxes = routes.reduce((sum, r) => sum + r.totalBoxes, 0);
  const revenue = round2(pricePerBox * totalBoxes);
  const foodCost = round2(foodCostPerBox * totalBoxes);
  const grossProfit = round2(revenue - foodCost);
  const riderCallFees = round2(routes.reduce((sum, r) => sum + r.cost.callFee, 0));
  const distanceFees = round2(routes.reduce((sum, r) => sum + r.cost.distanceFee, 0));
  const deliveryCost = round2(routes.reduce((sum, r) => sum + r.cost.total, 0));
  const netProfit = round2(grossProfit - deliveryCost);
  return {
    orderCount: routes.reduce((sum, r) => sum + r.stops.length, 0),
    totalBoxes,
    riderCount: routes.length,
    totalDistanceKm: round2(routes.reduce((sum, r) => sum + r.distanceKm, 0)),
    revenue,
    foodCost,
    grossProfit,
    riderCallFees,
    distanceFees,
    deliveryCost,
    netProfit,
    isProfitable: netProfit >= 0,
    lastFinishTime: routes.reduce((latest, r) => (r.finishTime > latest ? r.finishTime : latest), "00:00"),
    allOnTime: routes.every((r) => r.onTime),
  };
}

/** ข้อความเตือนบนหน้าจอ: ส่งเกินเวลา (ทีละจุด) และแผนขาดทุน */
export function planWarnings(routes: Route[], summary: PlanSummary): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  for (const route of routes) {
    for (const stop of route.stops) {
      if (!stop.onTime) {
        warnings.push({
          code: "LATE_DELIVERY",
          message: `ไรเดอร์คนที่ ${route.riderNo} ส่งจุดที่ ${stop.seq} ถึงเวลา ${stop.eta} เกินกำหนด ${config.delivery.deadline}`,
          riderNo: route.riderNo,
        });
      }
    }
  }
  if (!summary.isProfitable) {
    warnings.push({
      code: "NOT_PROFITABLE",
      message: `แผนนี้ขาดทุน ${Math.abs(summary.netProfit).toFixed(2)} บาท ลองกดคำนวณใหม่`,
    });
  }
  return warnings;
}
