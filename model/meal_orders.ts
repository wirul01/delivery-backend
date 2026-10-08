import { buyer } from "./buyers";

// 1. Model หลักสำหรับข้อมูล Meal Orders (ตรงตาม DB/Response)
export interface MealOrders {
  order_id: number;
  order_number: string;
  buyer_id: number;
  target_date: string;
  quantity: number;
  selling_price: number;
  cost_price: number;
  delivery_latitude: number;
  delivery_longitude: number;
  creation_type: "MANUAL" | "AUTO_MATCHED";
  order_status: "QUEUED" | "SHIPPED";
  created_at: string;
  updated_at: string;
}

// 2. Response ที่มีข้อมูลลูกค้าติดไปด้วย + ระยะทาง
export interface MealOrderWithBuyer extends MealOrders {
  buyer?: buyer;
  distance_km?: number;
}

// 3. Request สำหรับสร้าง Order ใหม่ (ไม่ต้องส่ง order_id, created_at, updated_at เพราะ DB เจนให้)
export interface MealOrderPostRequest {
  order_number: string;
  buyer_id: number;
  target_date: string;
  quantity: number;
  selling_price: number;
  cost_price: number;
  delivery_latitude: number;
  delivery_longitude: number;
  creation_type?: "MANUAL" | "AUTO_MATCHED";
  order_status?: "QUEUED" | "SHIPPED";
}

// 4. Request สำหรับแก้ไขจำนวนกล่อง
export interface UpdateQuantityRequest {
  quantity: number;
}

// 5. Query Parameters สำหรับค้นหาออเดอร์ใกล้เคียง (เหมือน NearbyQueryParams ของ buyer)
export interface NearbyQueryParams {
  lat?: string;
  lng?: string;
  radiusKm?: string;
}