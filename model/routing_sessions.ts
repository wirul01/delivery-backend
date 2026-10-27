import { OptimizationGoal } from "../routing";

// 1. แถวในตาราง routing_sessions (1 แถว = การคำนวณเส้นทาง 1 ครั้ง)
export interface RoutingSession {
    session_id: number;
    session_date: string;                 // yyyy-MM-dd
    session_status: "DRAFT" | "LOCKED" | "VOIDED";
    optimization_goal: OptimizationGoal;
    iteration_number: number;             // คำนวณครั้งที่เท่าไรของวันนั้น
    algorithm_name: string;
    config_snapshot: any;                 // ค่าตั้งต้นของร้าน ณ ตอนคำนวณ
    total_orders: number;
    total_meals: number;
    total_couriers: number;               // จำนวนรอบ/จำนวนไรเดอร์ที่ต้องใช้
    total_distance_meters: number;
    latest_delivery_time: string;         // HH:MM:SS เวลาที่ส่งเสร็จช้าสุด
    total_revenue: number;
    total_meal_cost: number;
    total_delivery_cost: number;
    net_profit: number;
    is_deadline_met: number;              // 1 = ส่งทันทุกรอบ
    processing_time_ms: number | null;
    created_by_admin_id: number;
    created_at: string;
    locked_at: string | null;
}

// 2. ข้อมูลที่ส่งมาตอนสั่งคำนวณ (ไม่ส่งอะไรเลยก็ได้ จะใช้วันนี้ + ต้นทุนต่ำสุด)
export interface CalculateRequest {
    target_date?: string;                 // yyyy-MM-dd
    optimization_goal?: OptimizationGoal; // MIN_COST | MIN_DISTANCE | MIN_TIME
    max_couriers?: number;                // จำกัดจำนวนไรเดอร์ (ไม่ส่ง = ไม่จำกัด)
    admin_id?: number;                    // ไม่ส่ง = ใช้ผู้ดูแลคนแรกในระบบ
}

// 3. จุดแวะส่ง 1 จุดในรอบ (พร้อมข้อมูลลูกค้า ไว้วาดแผนที่/ทำใบงาน)
export interface TripNodeDetail {
    order_id: number;
    order_number: string;
    stop_sequence: number;
    leg_distance_meters: number;
    cumulative_distance_meters: number;
    estimated_arrival_time: string;
    delivered_at: string | null;          // เวลาที่ไรเดอร์กดยืนยันว่าส่งแล้ว (ISO) ยังไม่ส่ง = null
    quantity: number;
    customer_name: string;
    phone_number: string | null;
    latitude: number;
    longitude: number;
}

// 4. 1 รอบการวิ่งส่งของไรเดอร์ 1 คน
export interface CourierTripDetail {
    trip_id: number;
    trip_number: number;
    courier_id: number | null;
    route_color: string;                  // สีเส้นทางบนแผนที่ เช่น #E53935
    trip_access_code: string | null;      // รหัสใบงาน 8 ตัว (มีหลังยืนยันรอบ)
    stop_count: number;
    meal_count: number;
    trip_distance_meters: number;
    estimated_duration_min: number;
    completion_time: string;
    delivery_wage: number;
    nodes: TripNodeDetail[];
}

// 5. ออเดอร์ที่ยังไม่ได้อยู่ในแผน (เช่น ไกลเกินระยะส่ง หรือเพิ่มเข้ามาหลังคำนวณ)
export interface UnassignedOrderDetail {
    order_id: number;
    order_number: string;
    quantity: number;
    latitude: number;
    longitude: number;
    reason: string;
}

// 6. ผลลัพธ์เต็มของการคำนวณ 1 ครั้ง
export interface RoutingSessionDetail {
    session: RoutingSession;
    store: {
        name: string;
        latitude: number;
        longitude: number;
        dispatch_time: string;         // เวลาออกจากร้าน (ตอนคำนวณ)
        delivery_deadline: string;     // เวลาที่ต้องส่งเสร็จ
        max_distance_km: number;       // ระยะส่งสูงสุดจากร้าน
    };
    trips: CourierTripDetail[];
    unassigned: UnassignedOrderDetail[];
}
