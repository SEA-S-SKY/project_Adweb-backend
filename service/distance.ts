export interface LatLng {
  lat: number;
  lng: number;
}

/** ระยะเส้นตรงบนผิวโลก (Haversine) หน่วยกิโลเมตร */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * สูตร Haversine เป็นคำสั่ง SQL (หน่วยกิโลเมตร) ใช้แทน ST_Distance_Sphere
 * เพื่อให้รันได้ทั้ง MySQL, MariaDB และ TiDB (TiDB ยังไม่รองรับฟังก์ชัน spatial)
 * มี placeholder 3 ตัว ต้องส่ง params ตามลำดับ [lat, lat, lng] ของจุดศูนย์กลาง
 */
export function haversineSql(latCol: string, lngCol: string): string {
  return `(2 * 6371 * ASIN(SQRT(LEAST(1,
      POWER(SIN(RADIANS(${latCol} - ?) / 2), 2)
      + COS(RADIANS(?)) * COS(RADIANS(${latCol})) * POWER(SIN(RADIANS(${lngCol} - ?) / 2), 2)
    ))))`;
}
