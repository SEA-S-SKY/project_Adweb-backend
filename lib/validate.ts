import { config } from "../config";
import { badRequest, ErrorDetail } from "./http";

/** อ่านค่า query แบบ string ตัวเดียว (ตัดช่องว่าง, ค่าว่าง = undefined) */
export function queryString(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

export function parseId(value: string, field = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`${field} ต้องเป็นจำนวนเต็มบวก`, [{ field, message: "ต้องเป็นจำนวนเต็มบวก" }]);
  }
  return n;
}

/** วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** วันที่จาก query/body ถ้าไม่ส่งมาใช้วันนี้ (หรือ undefined ถ้า fallbackToday = false) */
export function parseDate(value: unknown, field: string, fallbackToday: false): string | undefined;
export function parseDate(value: unknown, field: string, fallbackToday?: true): string;
export function parseDate(value: unknown, field: string, fallbackToday = true): string | undefined {
  const s = typeof value === "string" ? value.trim() : queryString(value);
  if (s === undefined || s === "") return fallbackToday ? todayBangkok() : undefined;
  if (!isValidDate(s)) {
    throw badRequest(`${field} ต้องอยู่ในรูปแบบ YYYY-MM-DD`, [{ field, message: "รูปแบบ YYYY-MM-DD" }]);
  }
  return s;
}

/** lat, lng, radiusKm สำหรับ endpoint /nearby */
export function parseNearbyQuery(query: Record<string, unknown>, defaultRadiusKm: number) {
  const details: ErrorDetail[] = [];
  const lat = Number(queryString(query.lat));
  const lng = Number(queryString(query.lng));
  const radiusRaw = queryString(query.radiusKm);
  const radiusKm = radiusRaw === undefined ? defaultRadiusKm : Number(radiusRaw);

  if (queryString(query.lat) === undefined || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    details.push({ field: "lat", message: "บังคับ ต้องเป็นตัวเลขระหว่าง -90 ถึง 90" });
  }
  if (queryString(query.lng) === undefined || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    details.push({ field: "lng", message: "บังคับ ต้องเป็นตัวเลขระหว่าง -180 ถึง 180" });
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > config.nearby.maxRadiusKm) {
    details.push({ field: "radiusKm", message: `ต้องมากกว่า 0 และไม่เกิน ${config.nearby.maxRadiusKm}` });
  }
  if (details.length) throw badRequest("พารามิเตอร์ค้นหาตามระยะไม่ถูกต้อง", details);
  return { lat, lng, radiusKm };
}
