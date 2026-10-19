export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "11:30" + 13.2 นาที → "11:44" (ปัดเศษนาทีขึ้น เหมือนฝั่ง frontend) */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + Math.ceil(minutes - 1e-9);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "2026-09-18 10:05:00" (เวลาไทยจากฐานข้อมูล) → "2026-09-18T10:05:00+07:00" */
export function toIsoBangkok(dt: string | null): string | null {
  if (!dt) return null;
  return dt.replace(" ", "T").slice(0, 19) + "+07:00";
}
