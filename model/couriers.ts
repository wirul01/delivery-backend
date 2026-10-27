export interface Courier {
    courier_id: number;
    full_name: string;
    phone_number: string;
    license_plate: string | null;
    is_active: number; // 1 = พร้อมรับงาน, 0 = ปิดรับ
    created_at: string;
}

export interface CourierPostRequest {
    full_name: string;
    phone_number: string;
    license_plate?: string | null;
    is_active?: boolean | number;
}

export type CourierPatchRequest = Partial<CourierPostRequest>;
