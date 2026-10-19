import { PoolConnection } from "mysql2/promise";
import { conn } from "../dbconnect";

/** รันหลายคำสั่งใน transaction เดียว ถ้า throw กลางทางจะ rollback ทั้งหมด */
export async function inTransaction<T>(work: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await conn.getConnection();
  try {
    await c.beginTransaction();
    const result = await work(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
