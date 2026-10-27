import express from "express";
import { conn } from "../dbconnect";
import { Courier, CourierPostRequest } from "../model/couriers";

export const router = express.Router();

// ดูไรเดอร์ทั้งหมด (ใส่ ?active=1 เพื่อดูเฉพาะคนที่พร้อมรับงาน)
router.get("/", async (req, res) => {
    try {
        let sql = "SELECT * FROM couriers";
        const params: any[] = [];

        if (req.query.active) {
            sql += " WHERE is_active = ?";
            params.push(req.query.active);
        }

        const [rows] = await conn.query(sql, params);
        let couriers = rows as Courier[];
        res.json(couriers);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// ดูไรเดอร์ตาม id
router.get("/:id", async (req, res) => {
    try {
        const [rows] = await conn.query("SELECT * FROM couriers WHERE courier_id = ?", [
            req.params.id,
        ]);
        let couriers = rows as Courier[];

        if (couriers.length === 0) {
            return res.status(404).json({ error: "Courier not found" });
        }

        res.json(couriers[0]);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

//insert
router.post("/", async (req, res) => {
    try {
        let courier: CourierPostRequest = req.body;
        console.log(req.body);

        let sql =
            "INSERT INTO `couriers`(`full_name`, `phone_number`, `license_plate`, `is_active`) VALUES (?,?,?,?)";

        const [result] = await conn.query(sql, [
            courier.full_name,
            courier.phone_number,
            courier.license_plate ?? null, // ไม่ส่งทะเบียนมา = ไม่มีทะเบียน
            courier.is_active ?? 1 // ไม่ส่งมา = พร้อมรับงาน
        ]);

        // แปลงผลลัพธ์เพื่อนำมาสกัดหาข้อมูลแถวที่ทำรายการสำเร็จ
        const insertResult = result as any;
        res.status(201).json({
            affected_row: insertResult.affectedRows, // จำนวนแถวที่ได้รับผลกระทบ (สำเร็จ = 1)
            last_idx: insertResult.insertId // รหัสไอดีล่าสุดที่ระบบสร้างขึ้นให้อัตโนมัติ (Auto increment id)
        });
    } catch (error) {
        const err = error as any;

        if (err.code === "ER_DUP_ENTRY") {
            res.status(409).json({
                error: "Phone number already exists"
            });
            return;
        }

        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
});

//delete
router.delete("/:id", async (req, res) => {
    try {
        let id = req.params.id;
        const [result] = await conn.query("DELETE FROM couriers WHERE courier_id = ?", [id]);
        const deleteResult = result as any;

        // ตรวจเช็กสักนิดว่ามีแถวถูกลบจริงไหม หากไม่มีแสดงว่าไม่พบไอดีในฐานข้อมูล ส่งกลับรหัส 404
        if (deleteResult.affectedRows === 0) {
            return res.status(404).json({ error: "Courier not found" });
        }

        res.status(200).json({ affected_row: deleteResult.affectedRows });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

//อัพเดต (แก้เฉพาะช่องที่ส่งมา ช่องที่ไม่ส่งใช้ค่าเดิม รวมถึงเปิด-ปิดรับงานด้วย is_active)
router.patch("/:id", async (req, res) => {
    try {
        let id = +req.params.id;
        let courier: CourierPostRequest = req.body;

        // 1. ค้นหาข้อมูลเก่าก่อน
        let sql = conn.format("SELECT * FROM couriers WHERE courier_id = ?", [id]);
        let [response] = await conn.query(sql);
        let result = response as Courier[];

        if (result.length > 0) {
            let courierOriginal = result[0];

            // 2. นำข้อมูลเก่ามาทับด้วยข้อมูลใหม่ที่ส่งมา
            let updateCourier = {
                ...courierOriginal,
                ...courier
            };

            // 3. เขียนข้อมูลที่รวมแล้วกลับลงฐานข้อมูล
            sql =
                "UPDATE `couriers` SET `full_name`=?, `phone_number`=?, `license_plate`=?, `is_active`=? WHERE `courier_id`=?";

            sql = conn.format(sql, [
                updateCourier.full_name,
                updateCourier.phone_number,
                updateCourier.license_plate,
                updateCourier.is_active,
                id
            ]);

            const [records] = await conn.query(sql);
            const updateResult = records as any;

            res.status(200).json({ affected_row: updateResult.affectedRows });
        } else {
            res.status(404).json({ message: "Courier not found" });
        }
    } catch (error) {
        const err = error as any;

        if (err.code === "ER_DUP_ENTRY") {
            res.status(409).json({ error: "Phone number already exists" });
            return;
        }

        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
});
