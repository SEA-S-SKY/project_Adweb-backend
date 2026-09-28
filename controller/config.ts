import express from "express";
import { config } from "../config";

export const router = express.Router();

// GET /api/config — ค่าคงที่ทั้งหมดให้ frontend (รูปแบบตรงกับ AppConfig ใน api.models.ts)
router.get("/", (req, res) => {
  res.json({
    shop: config.shop,
    pricing: config.pricing,
    delivery: config.delivery,
    riderColors: config.riderColors,
  });
});
