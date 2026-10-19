-- =====================================================================
-- ฐานข้อมูลระบบจัดเส้นทางและแบ่งงานไรเดอร์ (MySQL 8)
-- ตรงกับ "โครงสร้างฐานข้อมูล" ใน API.md และ ER Diagram ใน docs/er-diagram.md
--
-- รัน:  npm run db:init   (อ่านค่าเชื่อมต่อจาก .env)
-- ⚠️ ไฟล์นี้ DROP ตารางเดิมทั้งหมดก่อนสร้างใหม่ ข้อมูลเก่าจะหาย
-- =====================================================================

SET NAMES utf8mb4;

DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS job_stops;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;

-- ---------------------------------------------------------------------
-- customers — @hashack05
-- ---------------------------------------------------------------------
CREATE TABLE customers (
  id          INT           NOT NULL AUTO_INCREMENT,
  first_name  VARCHAR(50)   NOT NULL,
  last_name   VARCHAR(50)   NOT NULL,
  phone       VARCHAR(20)   NOT NULL,
  address     VARCHAR(255)  NULL,
  lat         DECIMAL(9,6)  NOT NULL,
  lng         DECIMAL(9,6)  NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_customers_first_name (first_name),
  INDEX idx_customers_last_name (last_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- orders — @sakino06
-- ---------------------------------------------------------------------
CREATE TABLE orders (
  id           INT      NOT NULL AUTO_INCREMENT,
  customer_id  INT      NOT NULL,
  quantity     TINYINT  NOT NULL,
  order_date   DATE     NOT NULL,
  status       ENUM('pending', 'assigned', 'delivered') NOT NULL DEFAULT 'pending',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_orders_date_status (order_date, status),
  CONSTRAINT chk_orders_quantity CHECK (quantity BETWEEN 1 AND 3),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- plans — @SeMple1
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id           INT      NOT NULL AUTO_INCREMENT,
  plan_date    DATE     NOT NULL,
  status       ENUM('draft', 'confirmed') NOT NULL DEFAULT 'draft',
  seed         INT      NOT NULL,
  result_json  JSON     NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_plans_date (plan_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- jobs และ job_stops — @SEA-S-SKY
-- ---------------------------------------------------------------------
CREATE TABLE jobs (
  id           INT           NOT NULL AUTO_INCREMENT,
  job_no       VARCHAR(10)   NOT NULL,
  plan_id      INT           NOT NULL,
  job_date     DATE          NOT NULL,
  rider_no     INT           NOT NULL,
  color        CHAR(7)       NOT NULL,
  total_boxes  INT           NOT NULL,
  distance_km  DECIMAL(6,2)  NOT NULL,
  cost         DECIMAL(8,2)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_job_no (job_no),
  CONSTRAINT fk_jobs_plan FOREIGN KEY (plan_id) REFERENCES plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE job_stops (
  id            INT      NOT NULL AUTO_INCREMENT,
  job_id        INT      NOT NULL,
  seq           INT      NOT NULL,
  order_id      INT      NOT NULL,
  eta           TIME     NOT NULL,
  delivered_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_stops_order (order_id),      -- ออเดอร์ 1 รายการอยู่ได้ไม่เกิน 1 จุดส่ง
  UNIQUE KEY uq_job_stops_job_seq (job_id, seq), -- ลำดับในใบงานเดียวกันห้ามซ้ำ
  CONSTRAINT fk_job_stops_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
  CONSTRAINT fk_job_stops_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- events — แจ้งเตือนข้ามเครื่อง (ไรเดอร์เปิดงาน, ส่งสำเร็จ, ตำแหน่ง GPS)
-- ไม่ผูก foreign key เพราะเป็น log ชั่วคราว ลบอัตโนมัติเมื่อเก่ากว่า config.events.keepDays วัน
-- ถ้าฐานข้อมูลมีอยู่แล้ว ใช้ npm run db:migrate เพิ่มตารางนี้โดยไม่ลบข้อมูลเดิม
-- ---------------------------------------------------------------------
CREATE TABLE events (
  id          VARCHAR(128) NOT NULL,
  event_type  VARCHAR(40)  NOT NULL,
  job_no      VARCHAR(10)  NULL,
  payload     JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL, -- เวลาไทย แปลงจาก createdAt ที่ส่งมา
  PRIMARY KEY (id),
  INDEX idx_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ลูกค้าตัวอย่าง 30 คน อยู่ในรัศมี 3 กม. จากร้าน (16.2458, 103.2500)
-- ชื่อและเบอร์เป็นข้อมูลสมมติ
-- ---------------------------------------------------------------------
INSERT INTO customers (first_name, last_name, phone, address, lat, lng) VALUES
('สมชาย', 'ใจดี', '0913998698', 'หอพักใน ตึก A ห้อง 204', 16.245654, 103.240463),
('สมหญิง', 'รักดี', '0897309114', 'หอพักเรือนรัก ห้อง 12', 16.222450, 103.254071),
('ธนพล', 'ศรีสุข', '0975364556', 'คณะวิศวกรรมศาสตร์ ชั้น 3', 16.253055, 103.227070),
('กมลชนก', 'บุญมา', '0651884472', 'ตึกอธิการบดี ชั้น 1', 16.243603, 103.223435),
('ณัฐวุฒิ', 'แก้วใส', '0940557616', 'คอนโดเดอะวิว ห้อง 508', 16.222655, 103.242876),
('พิมพ์ชนก', 'ทองดี', '0668976846', 'หอพักบ้านสวน ห้อง 7', 16.237633, 103.226273),
('อนุชา', 'มีสุข', '0980932081', 'อาคารเรียนรวม ห้อง 1201', 16.243639, 103.269979),
('วราภรณ์', 'พรหมมา', '0673177848', 'ร้านถ่ายเอกสารหน้ามอ', 16.255187, 103.229560),
('ศุภชัย', 'สายบุญ', '0987663440', 'หอพักพลอยเพลส ห้อง 305', 16.245616, 103.267033),
('จิราพร', 'คำภา', '0978753477', 'สำนักงานเทศบาล ฝ่ายทะเบียน', 16.241379, 103.246918),
('ปิยะพงษ์', 'ชัยศรี', '0880457178', 'โรงพยาบาลสุทธาเวช จุดคัดกรอง', 16.229363, 103.258823),
('สุภาวดี', 'ภูมิใจ', '0667147513', 'หมู่บ้านศรีสวัสดิ์ บ้านเลขที่ 45', 16.239538, 103.262139),
('กิตติพงษ์', 'อินทร์แก้ว', '0801079819', 'หอพักแสนสุข ห้อง 110', 16.257606, 103.230399),
('อรทัย', 'วงศ์ใหญ่', '0908452059', 'คณะแพทยศาสตร์ ห้องพักอาจารย์', 16.268792, 103.250323),
('ชยพล', 'ศรีวงศ์', '0828379298', 'ห้องสมุดกลาง เคาน์เตอร์ยืมคืน', 16.237032, 103.268142),
('มณีรัตน์', 'นามวงศ์', '0629486628', 'ตลาดน้อย ร้านผ้า', 16.252747, 103.237347),
('ธีรวัฒน์', 'ปัญญาดี', '0661055008', 'หอพักรินทร์ทอง ห้อง 21', 16.262088, 103.232935),
('นภัสสร', 'จันทร์หอม', '0851779922', 'อาคารวิทยาศาสตร์ ห้องแล็บ 2', 16.229489, 103.242418),
('วีรยุทธ', 'ทองคำ', '0957931860', 'ศูนย์กีฬา สนามแบด', 16.264966, 103.255493),
('ปวีณา', 'บุญเรือง', '0680737028', 'หอพักภูมิใจ ห้อง 409', 16.240291, 103.260595),
('อภิชาติ', 'สุขเจริญ', '0622646861', 'บ้านพักอาจารย์ หลังที่ 8', 16.237553, 103.259396),
('ศิริพร', 'พลราช', '0647764725', 'สำนักคอมพิวเตอร์ ชั้น 2', 16.260648, 103.256397),
('เกียรติศักดิ์', 'ดวงแก้ว', '0984133017', NULL, 16.252167, 103.231853),
('รัชนี', 'โพธิ์ศรี', '0920525898', 'คณะบัญชี ห้อง 302', 16.257148, 103.232004),
('ภานุวัฒน์', 'แสงทอง', '0889394948', 'ร้านกาแฟริมบึง', 16.237398, 103.240835),
('ชนิดา', 'มูลมาตย์', '0662105218', NULL, 16.236301, 103.251973),
('พงศกร', 'ศรีภูมิ', '0645244106', 'หอพักชมพู ห้อง 15', 16.238129, 103.237160),
('ธิดารัตน์', 'บุตรดี', '0860013041', 'อาคารกิจกรรมนิสิต', 16.232292, 103.270538),
('สุรเชษฐ์', 'วงศ์สวัสดิ์', '0857990659', 'ธนาคารหน้ามอ', 16.242699, 103.242069),
('กัญญารัตน์', 'ประทุมมา', '0915846450', 'หอพักธารทิพย์ ห้อง 101', 16.248632, 103.237739);
