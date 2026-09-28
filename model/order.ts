import { round2, toIsoBangkok } from "../lib/format";

export type OrderStatus = "pending" | "assigned" | "delivered";
export const ORDER_STATUSES: OrderStatus[] = ["pending", "assigned", "delivered"];

/** แถวจาก ORDER_SELECT (orders JOIN customers) */
export interface OrderRow {
  id: number;
  customer_id: number;
  quantity: number;
  order_date: string;
  status: OrderStatus;
  created_at: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  distance_km?: number;
}

/** รูปแบบที่ส่งออกทาง API (ตรงกับ Order ใน api.models.ts) */
export interface Order {
  id: number;
  customerId: number;
  customer: {
    id: number;
    firstName: string;
    lastName: string;
    phone: string;
    address: string | null;
    lat: number;
    lng: number;
  };
  quantity: number;
  orderDate: string;
  status: OrderStatus;
  createdAt: string | null;
  distanceKm?: number;
}

/** SELECT กลางของออเดอร์ แนบข้อมูลลูกค้ามาด้วยทุกครั้ง */
export const ORDER_SELECT = `
  SELECT o.id, o.customer_id, o.quantity, o.order_date, o.status, o.created_at,
         c.first_name, c.last_name, c.phone, c.address, c.lat, c.lng
  FROM orders o
  JOIN customers c ON c.id = o.customer_id`;

export function toOrder(r: OrderRow): Order {
  const o: Order = {
    id: r.id,
    customerId: r.customer_id,
    customer: {
      id: r.customer_id,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: r.phone,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
    },
    quantity: r.quantity,
    orderDate: r.order_date,
    status: r.status,
    createdAt: toIsoBangkok(r.created_at),
  };
  if (r.distance_km !== undefined) o.distanceKm = round2(r.distance_km);
  return o;
}
