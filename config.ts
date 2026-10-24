// ค่าคงที่ทั้งระบบ ส่งให้ frontend ผ่าน GET /api/config — ห้ามเขียนตัวเลขเหล่านี้ตรง ๆ ที่อื่น

export const config = {
  shop: {
    name: "ข้าวกล่องเดลิเวอรี ส่งด่วนมื้อเที่ยง",
    lat: 16.2458,
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
    stopDurationMin: 3,
    maxOrdersPerRider: 3,
    maxBoxesPerOrder: 3,
    serviceRadiusKm: 3,
    departTime: "11:30",
    deadline: "12:30",
    includeReturnTrip: false,
    // "osrm" = ระยะตามถนนจริง (ถ้า OSRM ล่มจะถอยไปใช้ haversine เอง) · "haversine" = เส้นตรง
    distanceMethod: "osrm" as "haversine" | "osrm",
  },
  routing: {
    osrmUrl: (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, ""),
    timeoutMs: 6000,
    maxTablePoints: 100, // OSRM สาธารณะรับ /table ได้ไม่เกิน 100 จุดต่อครั้ง
    geometryConcurrency: 2, // ยิงขอเส้นทางพร้อมกันกี่เส้น (OSRM สาธารณะไม่ชอบโดนยิงถี่)
    geometryBudgetMs: 5000, // เวลารวมสูงสุดที่ใช้ขอเส้นบนแผนที่ทุกไรเดอร์ (POST /plans จะได้ไม่ช้าเกิน ~11 วิ แม้ OSRM ค้าง)
    alternativeTolerance: 0.03, // ปุ่ม "คำนวณใหม่" เลือกได้เฉพาะแผนที่แพงกว่าแผนดีที่สุดไม่เกิน 3%
  },
  events: {
    keepDays: 2, // event เก่ากว่านี้ลบทิ้งอัตโนมัติ (ตำแหน่ง GPS ไรเดอร์ส่งมาถี่ ตารางจะได้ไม่บวม)
    maxPerRequest: 200,
    maxPayloadBytes: 8000,
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
