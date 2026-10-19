// เรียก OSRM (ระยะทางและเส้นทางตามถนนจริง) ถ้าเรียกไม่ได้คืน null ให้คนเรียกถอยไปใช้ haversine เอง
import { config } from "../config";
import { LatLng } from "./distance";
import { LatLngTuple } from "../model/plan";

function coords(points: LatLng[]): string {
  return points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
}

async function getJson<T>(path: string, timeoutMs = config.routing.timeoutMs): Promise<T | null> {
  if (timeoutMs <= 0) return null;
  try {
    const res = await fetch(`${config.routing.osrmUrl}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as T & { code?: string };
    return data.code === "Ok" ? data : null;
  } catch {
    return null;
  }
}

/**
 * ตารางระยะทางตามถนน (กม.) ระหว่างทุกคู่จุด: km[i][j] = ระยะจาก i ไป j
 * ช่องที่ OSRM หาเส้นทางไม่เจอจะเป็น null
 */
export async function osrmDistanceTable(points: LatLng[]): Promise<(number | null)[][] | null> {
  if (points.length < 2 || points.length > config.routing.maxTablePoints) return null;
  const data = await getJson<{ distances?: (number | null)[][] }>(
    `/table/v1/driving/${coords(points)}?annotations=distance`
  );
  const table = data?.distances;
  if (!table || table.length !== points.length) return null;
  return table.map((row) => row.map((m) => (typeof m === "number" ? m / 1000 : null)));
}

/** เส้นทางตามถนนที่วิ่งผ่านทุกจุดตามลำดับ ใช้วาดบนแผนที่ ([lat, lng]) */
export async function osrmPath(points: LatLng[], timeoutMs?: number): Promise<LatLngTuple[] | null> {
  if (points.length < 2) return null;
  const data = await getJson<{ routes?: { geometry?: { coordinates?: [number, number][] } }[] }>(
    `/route/v1/driving/${coords(points)}?overview=full&geometries=geojson&steps=false`,
    timeoutMs
  );
  const line = data?.routes?.[0]?.geometry?.coordinates;
  return line?.length ? line.map(([lng, lat]) => [lat, lng] as LatLngTuple) : null;
}
