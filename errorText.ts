// ข้อความ error ตอนเซิร์ฟเวอร์พัง (500) — ถ้าสาเหตุคือฐานข้อมูลยังไม่มีคอลัมน์ delivered_at ให้บอกวิธีแก้ตรง ๆ
export function serverErrorBody(error: any): { error: string } {
    if (error?.code === "ER_BAD_FIELD_ERROR" && String(error?.message).includes("delivered_at")) {
        return {
            error: "ฐานข้อมูลยังไม่มีคอลัมน์ delivered_at ให้รันคำสั่งนี้ในฐานข้อมูลหนึ่งครั้ง: ALTER TABLE trip_nodes ADD COLUMN delivered_at DATETIME NULL;",
        };
    }
    return { error: "Internal server error" };
}
