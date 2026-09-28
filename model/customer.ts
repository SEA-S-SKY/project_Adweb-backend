import { config } from "../config";
import { round2, toIsoBangkok } from "../lib/format";
import { badRequest, ApiError, ErrorDetail } from "../lib/http";
import { haversineKm } from "../service/distance";

/** แถวในตาราง customers */
export interface CustomerRow {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  created_at: string;
  updated_at: string;
  distance_km?: number;
}

/** รูปแบบที่ส่งออกทาง API (ตรงกับ Customer ใน api.models.ts) */
export interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  distanceFromShopKm: number;
  createdAt: string | null;
  updatedAt: string | null;
  distanceKm?: number;
}

/** body ของ POST / PUT */
export interface CustomerInput {
  firstName: string;
  lastName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
}

export function toCustomer(r: CustomerRow): Customer {
  const c: Customer = {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    distanceFromShopKm: round2(haversineKm(config.shop, r)),
    createdAt: toIsoBangkok(r.created_at),
    updatedAt: toIsoBangkok(r.updated_at),
  };
  if (r.distance_km !== undefined) c.distanceKm = round2(r.distance_km);
  return c;
}

function text(body: Record<string, unknown>, field: string, max: number, required: boolean, details: ErrorDetail[]) {
  const v = body[field];
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (required) details.push({ field, message: "บังคับกรอก" });
    return null;
  }
  if (typeof v !== "string") {
    details.push({ field, message: "ต้องเป็นข้อความ" });
    return null;
  }
  const t = v.trim();
  if (t.length > max) details.push({ field, message: `ยาวได้ไม่เกิน ${max} ตัวอักษร` });
  return t;
}

/** ตรวจ body ของลูกค้าตามกติกาใน API.md แล้วคืนค่าที่ทำความสะอาดแล้ว */
export function parseCustomerInput(body: unknown): CustomerInput {
  if (typeof body !== "object" || body === null) throw badRequest("ต้องส่ง body เป็น JSON");
  const b = body as Record<string, unknown>;
  const details: ErrorDetail[] = [];

  const firstName = text(b, "firstName", 50, true, details);
  const lastName = text(b, "lastName", 50, true, details);
  const address = text(b, "address", 255, false, details);

  let phone = "";
  if (typeof b.phone !== "string" && typeof b.phone !== "number") {
    details.push({ field: "phone", message: "บังคับกรอก" });
  } else {
    phone = String(b.phone).replace(/[\s-]/g, "");
    if (!/^\d{9,10}$/.test(phone)) details.push({ field: "phone", message: "ต้องเป็นตัวเลข 9–10 หลัก" });
  }

  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const latOk = typeof b.lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const lngOk = typeof b.lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  if (!latOk) details.push({ field: "lat", message: "บังคับ ต้องเป็นตัวเลขระหว่าง -90 ถึง 90" });
  if (!lngOk) details.push({ field: "lng", message: "บังคับ ต้องเป็นตัวเลขระหว่าง -180 ถึง 180" });

  if (details.length) throw badRequest("ข้อมูลลูกค้าไม่ถูกต้อง", details);

  const km = haversineKm(config.shop, { lat, lng });
  if (km > config.delivery.serviceRadiusKm) {
    throw new ApiError(
      400,
      "OUT_OF_SERVICE_AREA",
      `พิกัดอยู่ห่างร้าน ${round2(km)} กม. เกินรัศมีให้บริการ ${config.delivery.serviceRadiusKm} กม.`,
      [{ field: "lat", message: "อยู่นอกพื้นที่ให้บริการ" }]
    );
  }

  return {
    firstName: firstName!,
    lastName: lastName!,
    phone,
    address,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
  };
}
