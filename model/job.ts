import { config } from "../config";
import { toIsoBangkok } from "../lib/format";
import { LatLngTuple, parseJson, PlanResult, Route } from "./plan";

// รูปแบบตรงกับ JobListItem / Job ใน API.md / api.models.ts ฝั่ง frontend

export interface JobListItem {
  jobNo: string;
  riderNo: number;
  color: string;
  totalBoxes: number;
  stopCount: number;
  deliveredCount: number;
  distanceKm: number;
  finishTime: string;
}

export interface JobStop {
  seq: number;
  orderId: number;
  customerId: number;
  customerName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  quantity: number;
  eta: string;
  delivered: boolean;
  deliveredAt: string | null;
  navigateUrl: string;
}

export interface Job {
  jobNo: string;
  date: string;
  riderNo: number;
  color: string;
  totalBoxes: number;
  distanceKm: number;
  departTime: string;
  finishTime: string;
  deadline: string;
  shop: typeof config.shop;
  stops: JobStop[];
  path: LatLngTuple[];
  googleMapsUrl: string;
}

/** jobs JOIN plans (เอา finishTime และ path จาก result_json ของแผน) */
export const JOB_SELECT = `
  SELECT j.id, j.job_no, j.plan_id, j.job_date, j.rider_no, j.color, j.total_boxes, j.distance_km,
         p.result_json,
         (SELECT COUNT(*) FROM job_stops s WHERE s.job_id = j.id) AS stop_count,
         (SELECT COUNT(*) FROM job_stops s WHERE s.job_id = j.id AND s.delivered_at IS NOT NULL) AS delivered_count
  FROM jobs j
  JOIN plans p ON p.id = j.plan_id`;

export interface JobRow {
  id: number;
  job_no: string;
  plan_id: number;
  job_date: string;
  rider_no: number;
  color: string;
  total_boxes: number;
  distance_km: number;
  result_json: PlanResult | string;
  stop_count: number;
  delivered_count: number;
}

/** job_stops JOIN orders JOIN customers */
export const JOB_STOP_SELECT = `
  SELECT s.seq, s.order_id, s.eta, s.delivered_at,
         o.quantity, o.customer_id, c.first_name, c.last_name, c.phone, c.address, c.lat, c.lng
  FROM job_stops s
  JOIN orders o ON o.id = s.order_id
  JOIN customers c ON c.id = o.customer_id`;

export interface JobStopRow {
  seq: number;
  order_id: number;
  eta: string;
  delivered_at: string | null;
  quantity: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
}

function routeOf(r: JobRow): Route | undefined {
  return parseJson(r.result_json).routes.find((route) => route.jobNo === r.job_no);
}

export function toJobListItem(r: JobRow): JobListItem {
  return {
    jobNo: r.job_no,
    riderNo: r.rider_no,
    color: r.color,
    totalBoxes: r.total_boxes,
    stopCount: Number(r.stop_count),
    deliveredCount: Number(r.delivered_count),
    distanceKm: r.distance_km,
    finishTime: routeOf(r)?.finishTime ?? config.delivery.departTime,
  };
}

const navigateUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

/** เส้นทางเต็มใน Google Maps: ร้าน → จุดระหว่างทาง (waypoints คั่นด้วย %7C) → จุดสุดท้าย */
function googleMapsUrl(stops: JobStop[]): string {
  const { lat, lng } = config.shop;
  const last = stops[stops.length - 1];
  if (!last) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const waypoints = stops
    .slice(0, -1)
    .map((s) => `${s.lat},${s.lng}`)
    .join("%7C");
  return (
    `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${last.lat},${last.lng}` +
    (waypoints ? `&waypoints=${waypoints}` : "") +
    "&travelmode=driving"
  );
}

export function toJob(r: JobRow, stopRows: JobStopRow[]): Job {
  const route = routeOf(r);
  const stops = stopRows.map(
    (s): JobStop => ({
      seq: s.seq,
      orderId: s.order_id,
      customerId: s.customer_id,
      customerName: `${s.first_name} ${s.last_name}`,
      phone: s.phone,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      quantity: s.quantity,
      eta: s.eta.slice(0, 5),
      delivered: s.delivered_at !== null,
      deliveredAt: toIsoBangkok(s.delivered_at),
      navigateUrl: navigateUrl(s.lat, s.lng),
    })
  );
  return {
    jobNo: r.job_no,
    date: r.job_date,
    riderNo: r.rider_no,
    color: r.color,
    totalBoxes: r.total_boxes,
    distanceKm: r.distance_km,
    departTime: config.delivery.departTime,
    finishTime: route?.finishTime ?? config.delivery.departTime,
    deadline: config.delivery.deadline,
    shop: config.shop,
    stops,
    path: route?.path ?? [[config.shop.lat, config.shop.lng], ...stops.map((s) => [s.lat, s.lng] as LatLngTuple)],
    googleMapsUrl: googleMapsUrl(stops),
  };
}
