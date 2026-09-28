export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-09-18 10:05:00" (เวลาไทยจากฐานข้อมูล) → "2026-09-18T10:05:00+07:00" */
export function toIsoBangkok(dt: string | null): string | null {
  if (!dt) return null;
  return dt.replace(" ", "T").slice(0, 19) + "+07:00";
}
