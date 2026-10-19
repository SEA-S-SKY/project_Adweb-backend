import express from "express";
import cors from "cors";
import { router as config } from "./controller/config";
import { router as customers } from "./controller/customers";
import { router as orders } from "./controller/orders";
import { router as plans } from "./controller/plans";
import { router as jobs } from "./controller/jobs";
import { router as events } from "./controller/events";
import { errorHandler, notFoundHandler } from "./lib/http";

export const app = express();

// CORS_ORIGINS คั่นด้วยจุลภาค เช่น "http://localhost:4200,https://project-adweb.vercel.app" หรือ "*" = อนุญาตทุกที่
const origins = (process.env.CORS_ORIGINS ?? "http://localhost:4200")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: origins.includes("*") ? "*" : origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ name: "project_Adweb API", status: "ok", docs: "ดู API.md ใน repo" });
});

app.use("/api/config", config);
app.use("/api/customers", customers);
app.use("/api/orders", orders);
app.use("/api/plans", plans); // @SeMple1 (อัลกอริทึมอยู่ใน service/routing.ts)
app.use("/api/jobs", jobs); // @SEA-S-SKY
app.use("/api/events", events); // แจ้งเตือนข้ามเครื่อง

app.use(notFoundHandler);
app.use(errorHandler);

// Vercel หาไฟล์ app.ts แล้วใช้ default export เป็น serverless function (ไม่ได้รัน server.ts)
export default app;
