import { NextFunction, Request, Response } from "express";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "OUT_OF_SERVICE_AREA"
  | "CUSTOMER_HAS_ORDERS"
  | "ORDER_LOCKED"
  | "NO_ORDERS"
  | "PLAN_ALREADY_CONFIRMED"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  field: string;
  message: string;
}

/** throw ตัวนี้จาก controller แล้ว errorHandler จะตอบกลับเป็นรูปแบบ error กลางของ API.md */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: ErrorDetail[]
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]) =>
  new ApiError(400, "VALIDATION_ERROR", message, details);

export const notFound = (message: string) => new ApiError(404, "NOT_FOUND", message);

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `ไม่พบ ${req.method} ${req.originalUrl}` },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }
  // body ที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง
  if (typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "รูปแบบ JSON ไม่ถูกต้อง" } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาดฝั่ง server" } });
}
