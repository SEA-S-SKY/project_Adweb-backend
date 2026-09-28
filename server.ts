import "dotenv/config";
import http from "http";
import { app } from "./app";

// Render ส่งพอร์ตมาทาง PORT (ตัวพิมพ์ใหญ่)
const port = process.env.PORT || 3000;
const server = http.createServer(app);

server
  .listen(port, () => {
    console.log(`Server is started on port ${port}`);
  })
  .on("error", (error) => {
    console.error(error);
  });
