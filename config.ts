// ค่าคงที่ทั้งระบบ ส่งให้ frontend ผ่าน GET /api/config — ห้ามเขียนตัวเลขเหล่านี้ตรง ๆ ที่อื่น
// ค่าที่มี ⚠️ ยังรอทีมตกลง (ดู TASKS.md)

export const config = {
  shop: {
    name: "ข้าวกล่องเดลิเวอรี ส่งด่วนมื้อเที่ยง",
    lat: 16.2458, // ⚠️ ข้อ 2 รอทีมยืนยัน
    lng: 103.25,
  },
  pricing: {
    pricePerBox: 65,
    foodCostPerBox: 40,
    riderCallFee: 15,
    distanceFeePerKmPerBox: 2,
  },
  delivery: {
    riderSpeedKmh: 30,
    stopDurationMin: 3, // ⚠️ ข้อ 5
    maxOrdersPerRider: 3,
    maxBoxesPerOrder: 3,
    serviceRadiusKm: 3,
    departTime: "11:30",
    deadline: "12:30",
    includeReturnTrip: false, // ⚠️ ข้อ 3 รอถามอาจารย์
    distanceMethod: "haversine" as "haversine" | "osrm", // ⚠️ ข้อ 4
  },
  simulate: {
    minOrders: 20,
    maxOrders: 30,
  },
  nearby: {
    customerRadiusKm: 1, // HW-5 ข้อ 2.3
    orderRadiusKm: 2, // HW-5 ข้อ 3.3
    maxRadiusKm: 50,
  },
  riderColors: [
    "#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7",
    "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
  ],
};
