
import express from "express";
import { conn } from "../dbconnect";
import { buyerPostRequest, buyer, NearbyQueryParams } from "../model/buyers";


export const router = express.Router();

router.get("/", async (req, res) => {
    const [rows] = await conn.query("SELECT * FROM buyers");
    let buyers = rows as buyer[];
    res.json(buyers);
});

// GET/nearby ค้นหาลูกค้าในระยะรัศมี 
router.get("/nearby", async (req, res) => {
    try {
        const lat = parseFloat(req.query.latitude as string);
        const long = parseFloat(req.query.longitude as string);
        // ระยะรัศมีหน่วยกิโลเมตร (ถ้าไม่ส่งมาให้ default ที่ 1.0 กม.)
        const radiusKm = parseFloat(req.query.radius as string) || 1.0;

        if (isNaN(lat) || isNaN(long)) {
            return res.status(400).json({
                error: "โปรดระบุพิกัด lat และ lng ให้ถูกต้องใน Query Parameters"
            });
        }

        // สูตร Haversine คำนวณระยะทางจาก lat_val และ lng_val
        const sql = `
            SELECT *,
                ( 6371 * acos(
                    cos( radians(?) ) * cos( radians( latitude ) )
                    * cos( radians( longitude ) - radians(?) )
                    + sin( radians(?) ) * sin( radians( latitude ) )
                ) ) AS distance_km
            FROM buyers
            HAVING distance_km <= ?
            ORDER BY distance_km ASC
        `;

        const [rows] = await conn.query(sql, [lat, long, lat, radiusKm]);
        const buyers = rows as (buyer & { distance_km: number })[];

        res.json(buyers);
    } catch (error: any) {
        console.error("🔴 NEARBY SEARCH ERROR:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
});



//search
router.get("/search", async (req, res) => {
    try {
        const { id, first_name, last_name } = req.query;

        let sql = "SELECT * FROM buyers WHERE 1=1";
        const params: any[] = [];

        // ถ้ามีการส่ง id มา ให้บวกเงื่อนไขเพิ่ม
        if (id) {
            sql += " AND buyer_id = ?";
            params.push(id);
        }

        // ถ้ามีการส่ง first_name มา ค้นหาแบบ Partial Match
        if (first_name) {
            sql += " AND first_name LIKE ?";
            params.push(`%${first_name}%`);
        }

        // ถ้ามีการส่ง last_name (นามสกุล) มา
        if (last_name) {
            sql += " AND last_name LIKE ?";
            params.push(`%${last_name}%`);
        }

        const [rows] = await conn.query(sql, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});


//insert
router.post("/", async (req, res) => {
    try {
        let buyer: buyerPostRequest = req.body;
        console.log(req.body);

        let sql =
            "INSERT INTO buyers (first_name,last_name, phone_number, latitude, longitude) VALUES (?,?,?,?,?)";

        const [result] = await conn.query(sql, [
            buyer.first_name,
            buyer.last_name,
            buyer.phone_number,
            buyer.latitude,
            buyer.longitude
        ]);

        // แปลงผลลัพธ์เพื่อนำมาสกัดหาข้อมูลแถวที่ทำรายการสำเร็จ
        const insertResult = result as any;
        res.status(201).json({
            affected_row: insertResult.affectedRows, // จำนวนแถวที่ได้รับผลกระทบ (สำเร็จ = 1)
            last_idx: insertResult.insertId // รหัสไอดีล่าสุดที่ระบบสร้างขึ้นให้อัตโนมัติ (Auto increment id)
        });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});


//delete

router.delete("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        console.log("LOG - ID ที่รับมาลบ:", id);

        const [result] = await conn.query("DELETE FROM buyers WHERE buyer_id = ?", [id]);
        const deleteResult = result as any;

        if (deleteResult.affectedRows === 0) {
            return res.status(404).json({ error: "Buyer not found" });
        }

        return res.status(200).json({ affected_row: deleteResult.affectedRows });
    } catch (error: any) {
        console.error("🔴 DELETE ERROR DETAILS:", error);

        // เช็กถ้าติด Foreign Key Constraint (มีข้อมูลผูกอยู่ตารางอื่น)
        if (error.errno === 1451 || error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({
                error: "ไม่สามารถลบได้ เนื่องจากลูกค้าคนนี้มีข้อมูลเชื่อมอยู่กับตารางอื่น"
            });
        }

        return res.status(500).json({ error: "Internal server error", details: error.message });
    }
});

//อัพเดส
router.patch("/:id", async (req, res) => {

    let id = +req.params.id;

    let buyer: buyerPostRequest = req.body;

    let sql = conn.format(
        "SELECT * FROM buyers WHERE buyer_id = ?",
        [id]
    );

    let [response] = await conn.query(sql);

    let result = response as buyer[];

    if (result.length > 0) {

        let buyerOriginal = result[0];

        let updateBuyer = {
            ...buyerOriginal,
            ...buyer
        };

        sql = `
            UPDATE buyers
            SET first_name = ?,
                last_name = ?,
                phone_number = ?,
                latitude = ?,
                longitude = ?
            WHERE buyer_id = ?
        `;

        sql = conn.format(sql, [
            updateBuyer.first_name,
            updateBuyer.last_name,
            updateBuyer.phone_number,
            updateBuyer.latitude,
            updateBuyer.longitude,
            id
        ]);

        const [records] = await conn.query(sql);

        const updateResult = records as any;

        res.status(200).json({
            affected_row: updateResult.affectedRows
        });

    } else {

        res.status(404).json({
            message: "Buyer not found"
        });
    }
});


