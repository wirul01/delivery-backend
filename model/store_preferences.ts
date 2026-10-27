// ค่าตั้งต้นของร้าน (ตาราง store_preferences มีแถวเดียว config_id = 1)
export interface StorePreferences {
    config_id: number;
    store_name: string;
    store_latitude: number;
    store_longitude: number;
    price_per_meal: number;          // ราคาขายต่อกล่อง
    cost_per_meal: number;           // ต้นทุนต่อกล่อง
    rider_base_wage: number;         // ค่าจ้างไรเดอร์ต่อรอบ (บาท)
    wage_per_km_per_meal: number;    // บาทต่อกม. ต่อกล่อง
    avg_speed_kmh: number;           // ความเร็วเฉลี่ย
    dropoff_duration_min: number;    // เวลาแวะส่งต่อจุด (นาที)
    max_dropoffs_per_trip: number;   // จำนวนจุดส่งสูงสุดต่อรอบ (1-3)
    dispatch_time: string;           // "HH:MM:SS"
    delivery_deadline: string;       // "HH:MM:SS"
    max_distance_km: number;
    distance_multiplier: number;     // ตัวคูณระยะทางถนนจริงเทียบกับเส้นตรง
    last_updated: string;
}

// ส่งมาเฉพาะช่องที่ต้องการแก้ได้ (ไม่ต้องส่งครบ)
export type StorePreferencesUpdateRequest = Partial<
    Omit<StorePreferences, "config_id" | "last_updated">
>;
