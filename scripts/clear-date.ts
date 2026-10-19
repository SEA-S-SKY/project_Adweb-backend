// ลบข้อมูลของวันเดียว (ออเดอร์ แผน ใบงาน event) ใช้ล้างวันที่ใช้ทดสอบ เช่น หลังรัน load test
// ไม่แตะวันอื่น และไม่ลบลูกค้า
// รัน: npm run db:clear-date -- 2099-12-31
import "dotenv/config";
import { conn } from "../dbconnect";
import { inTransaction } from "../lib/db";
import { isValidDate } from "../lib/validate";

async function main() {
  const date = process.argv[2];
  if (!date || !isValidDate(date)) throw new Error("ใส่วันที่ เช่น npm run db:clear-date -- 2099-12-31");

  const result = await inTransaction(async (c) => {
    const [jobs] = await c.query("SELECT job_no FROM jobs WHERE job_date = ?", [date]);
    const jobNos = (jobs as { job_no: string }[]).map((j) => j.job_no);
    const [ev] = await c.query(
      "DELETE FROM events WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.date')) = ?" +
        (jobNos.length ? " OR job_no IN (?)" : ""),
      jobNos.length ? [date, jobNos] : [date]
    );
    await c.query("DELETE s FROM job_stops s JOIN jobs j ON j.id = s.job_id WHERE j.job_date = ?", [date]);
    const [j] = await c.query("DELETE FROM jobs WHERE job_date = ?", [date]);
    const [p] = await c.query("DELETE FROM plans WHERE plan_date = ?", [date]);
    const [o] = await c.query("DELETE FROM orders WHERE order_date = ?", [date]);
    const n = (r: unknown) => (r as { affectedRows: number }).affectedRows;
    return { events: n(ev), jobs: n(j), plans: n(p), orders: n(o) };
  });
  console.log(`ลบข้อมูลวันที่ ${date} แล้ว:`, result);
}

main()
  .then(() => conn.end())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ลบไม่สำเร็จ:", e.message);
    process.exit(1);
  });
