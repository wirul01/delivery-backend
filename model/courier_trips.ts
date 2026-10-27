// ใบงานที่ไรเดอร์เปิดดูด้วยรหัส 8 ตัว (GET /courier_trips/code/:code)

export interface RiderJobStop {
    stop_sequence: number;
    order_number: string;
    customer_name: string;
    phone_number: string | null;
    quantity: number;
    latitude: number;
    longitude: number;
    estimated_arrival_time: string;
    delivered_at: string | null;          // เวลาที่ไรเดอร์กดยืนยันว่าส่งแล้ว (ISO) ยังไม่ส่ง = null
    map_url: string;                      // ลิงก์เปิด Google Maps ไปที่จุดนี้
}

// ข้อมูลที่ส่งมาตอนกดยืนยัน/ยกเลิกการยืนยันว่าส่งจุดนี้แล้ว (ไม่ส่ง = true)
export interface DeliveredRequest {
    delivered?: boolean;
}

export interface RiderJob {
    trip_number: number;
    session_date: string;
    route_color: string;
    total_meals: number;                  // ต้องหยิบข้าวกล่องกี่กล่อง
    stop_count: number;
    delivered_count: number;              // ส่งเสร็จแล้วกี่จุด
    dispatch_time: string;
    delivery_deadline: string;
    completion_time: string;              // เวลาโดยประมาณที่ส่งถึงจุดสุดท้าย
    trip_distance_meters: number;
    delivery_wage: number;
    store: { name: string; latitude: number; longitude: number };
    summary: string;                      // สรุปเป็นข้อความอ่านง่าย
    route_map_url: string;                // ลิงก์เปิดเส้นทางทั้งรอบ ร้าน -> จุด 1 -> จุด 2 -> ...
    stops: RiderJobStop[];
}
