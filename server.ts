import "dotenv/config";
import http from "http";
import { app } from "./app";

// ใช้ตอนรันในเครื่อง (npm run dev / npm start) บน Vercel ไม่ได้ใช้ไฟล์นี้ แต่ใช้ default export ของ app.ts แทน
const port = process.env.PORT || 3000;
const server = http.createServer(app);

server
  .listen(port, () => {
    console.log(`Server is started on port ${port}`);
  })
  .on("error", (error) => {
    console.error(error);
  });
