import { toIsoBangkok } from "../lib/format";

// รูปแบบตรงกับ Plan ใน API.md / api.models.ts ฝั่ง frontend

export type PlanStatus = "draft" | "confirmed";
export type LatLngTuple = [number, number];
export type DistanceSource = "osrm" | "haversine";

export interface RouteCost {
  callFee: number;
  distanceFee: number;
  total: number;
}

export interface RouteStop {
  seq: number;
  orderId: number;
  customerId: number;
  customerName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  quantity: number;
  legDistanceKm: number;
  cumulativeDistanceKm: number;
  eta: string;
  onTime: boolean;
}

export interface Route {
  riderNo: number;
  color: string;
  jobNo: string | null;
  orderIds: number[];
  totalBoxes: number;
  distanceKm: number;
  durationMin: number;
  departTime: string;
  finishTime: string;
  onTime: boolean;
  cost: RouteCost;
  stops: RouteStop[];
  path: LatLngTuple[];
}

export interface PlanSummary {
  orderCount: number;
  totalBoxes: number;
  riderCount: number;
  totalDistanceKm: number;
  revenue: number;
  foodCost: number;
  grossProfit: number;
  riderCallFees: number;
  distanceFees: number;
  deliveryCost: number;
  netProfit: number;
  isProfitable: boolean;
  lastFinishTime: string;
  allOnTime: boolean;
}

export interface PlanWarning {
  code: "LATE_DELIVERY" | "NOT_PROFITABLE";
  message: string;
  riderNo?: number;
}

export interface Plan {
  id: number;
  date: string;
  status: PlanStatus;
  seed: number;
  createdAt: string | null;
  /** ระยะทางในแผนนี้มาจากไหน: ถนนจริง (osrm) หรือเส้นตรง (haversine ตอน OSRM ใช้ไม่ได้) */
  distanceSource: DistanceSource;
  routes: Route[];
  summary: PlanSummary;
  warnings: PlanWarning[];
}

/** สิ่งที่เก็บในคอลัมน์ plans.result_json */
export type PlanResult = Pick<Plan, "distanceSource" | "routes" | "summary" | "warnings">;

export interface PlanRow {
  id: number;
  plan_date: string;
  status: PlanStatus;
  seed: number;
  result_json: PlanResult | string;
  created_at: string;
}

/** mysql2 คืนคอลัมน์ JSON เป็น object แต่บางฐานข้อมูลคืนเป็น string จึงรองรับทั้งสองแบบ */
export function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

export function toPlan(r: PlanRow): Plan {
  const result = parseJson(r.result_json);
  return {
    id: r.id,
    date: r.plan_date,
    status: r.status,
    seed: r.seed,
    createdAt: toIsoBangkok(r.created_at),
    distanceSource: result.distanceSource ?? "haversine",
    routes: result.routes,
    summary: result.summary,
    warnings: result.warnings ?? [],
  };
}
