
import express from "express";
import { conn } from "../dbconnect";
import { buyerPostRequest, buyer } from "../model/customers";


export const router = express.Router();


router.get("/", async (req, res) => {
    const [rows] = await conn.query("SELECT * FROM buyers");
    let buyers = rows as buyer[];
    res.json(buyers);
});


//search
router.get("/search", async (req, res) => {
    try {
        const { id, name, last } = req.query;

        let sql = "SELECT * FROM buyers WHERE 1=1";
        const params: any[] = [];

        // ถ้ามีการส่ง id มา ให้บวกเงื่อนไขเพิ่ม
        if (id) {
            sql += " AND buyer_id = ?";
            params.push(id);
        }

        // ถ้ามีการส่ง name มา ค้นหาแบบ Partial Match
        if (name) {
            sql += " AND fname LIKE ?";
            params.push(`%${name}%`);
        }

        // ถ้ามีการส่ง last (นามสกุล) มา
        if (last) {
            sql += " AND lname LIKE ?";
            params.push(`%${last}%`);
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
            "INSERT INTO buyers (fname,lname, contact_no, lat_val, lng_val) VALUES (?,?,?,?,?)";

        const [result] = await conn.query(sql, [
            buyer.fname,
            buyer.lname,
            buyer.contact_no,
            buyer.lat_val,
            buyer.lng_val   
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
            SET fname = ?,
                lname = ?,
                contact_no = ?,
                lat_val = ?,
                lng_val = ?
            WHERE buyer_id = ?
        `;

        sql = conn.format(sql, [
            updateBuyer.fname,
            updateBuyer.lname,
            updateBuyer.contact_no,
            updateBuyer.lat_val,
            updateBuyer.lng_val,
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