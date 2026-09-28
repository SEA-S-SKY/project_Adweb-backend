import express from "express";
import cors from "cors";
import { router as config } from "./controller/config";
import { router as customers } from "./controller/customers";
import { router as orders } from "./controller/orders";
import { errorHandler, notFoundHandler } from "./lib/http";

export const app = express();

// CORS_ORIGINS คั่นด้วยจุลภาค เช่น "http://localhost:4200,https://adweb.onrender.com" หรือ "*" = อนุญาตทุกที่
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
// /api/plans และ /api/jobs: @SeMple1 และ @SEA-S-SKY เพิ่ม router ตรงนี้

app.use(notFoundHandler);
app.use(errorHandler);
