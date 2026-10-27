import express from "express";
import { conn } from "../dbconnect";
import { StorePreferences, StorePreferencesUpdateRequest } from "../model/store_preferences";

export const router = express.Router();

// ดูค่าตั้งต้นของร้าน (ตารางนี้มีแถวเดียว config_id = 1)
router.get("/", async (req, res) => {
    try {
        const [rows] = await conn.query("SELECT * FROM store_preferences WHERE config_id = 1");
        let prefs = rows as StorePreferences[];

        if (prefs.length === 0) {
            return res.status(404).json({ error: "Store preferences not found" });
        }

        res.json(prefs[0]);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// แก้ไขค่าตั้งต้นของร้าน (ส่งมาเฉพาะช่องที่ต้องการแก้ ช่องที่ไม่ส่งจะใช้ค่าเดิม)
router.patch("/", async (req, res) => {
    try {
        let pref: StorePreferencesUpdateRequest = req.body;

        // 1. ค้นหาข้อมูลเก่าก่อน
        let sql = conn.format("SELECT * FROM store_preferences WHERE config_id = ?", [1]);
        let [response] = await conn.query(sql);
        let result = response as StorePreferences[];

        if (result.length === 0) {
            return res.status(404).json({ message: "Store preferences not found" });
        }

        let prefOriginal = result[0];

        // 2. นำข้อมูลเก่ามาทับด้วยข้อมูลใหม่ที่ส่งมา
        let updatePref = {
            ...prefOriginal,
            ...pref
        };

        // 3. เขียนข้อมูลที่รวมแล้วกลับลงฐานข้อมูล
        sql =
            "UPDATE `store_preferences` SET `store_name`=?, `store_latitude`=?, `store_longitude`=?, `price_per_meal`=?, `cost_per_meal`=?, `rider_base_wage`=?, `wage_per_km_per_meal`=?, `avg_speed_kmh`=?, `dropoff_duration_min`=?, `max_dropoffs_per_trip`=?, `dispatch_time`=?, `delivery_deadline`=?, `max_distance_km`=?, `distance_multiplier`=? WHERE `config_id`=?";

        sql = conn.format(sql, [
            updatePref.store_name,
            updatePref.store_latitude,
            updatePref.store_longitude,
            updatePref.price_per_meal,
            updatePref.cost_per_meal,
            updatePref.rider_base_wage,
            updatePref.wage_per_km_per_meal,
            updatePref.avg_speed_kmh,
            updatePref.dropoff_duration_min,
            updatePref.max_dropoffs_per_trip,
            updatePref.dispatch_time,
            updatePref.delivery_deadline,
            updatePref.max_distance_km,
            updatePref.distance_multiplier,
            1
        ]);

        const [records] = await conn.query(sql);
        const updateResult = records as any;

        res.status(200).json({ affected_row: updateResult.affectedRows });
    } catch (error: any) {
        // ค่าที่ส่งมาผิดเงื่อนไขในฐานข้อมูล เช่น เวลาส่งถึงเป้าหมายต้องมาหลังเวลาเริ่มส่ง
        if (error.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
            return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง (เวลาส่งถึงเป้าหมายต้องมาหลังเวลาเริ่มส่ง)" });
        }

        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
});
