
import express from "express";
import { conn } from "../dbconnect";
import { CostomerPostRequest, Customer } from "../model/customers";


export const router = express.Router();


router.get("/", async (req, res) => {
    const [rows] = await conn.query("SELECT * FROM customers");
    let customers = rows as Customer[];
    res.json(customers);
});


//search
router.get("/search", async (req, res) => {
    try {
        const { id, name, last } = req.query;

        let sql = "SELECT * FROM customers WHERE 1=1";
        const params: any[] = [];

        // ถ้ามีการส่ง id มา ให้บวกเงื่อนไขเพิ่ม
        if (id) {
            sql += " AND customer_id = ?";
            params.push(id);
        }

        // ถ้ามีการส่ง name มา ค้นหาแบบ Partial Match
        if (name) {
            sql += " AND first_name LIKE ?";
            params.push(`%${name}%`);
        }

        // ถ้ามีการส่ง last (นามสกุล) มา
        if (last) {
            sql += " AND last_name LIKE ?";
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
        let customer: CostomerPostRequest = req.body;
        console.log(req.body);

        let sql =
            "INSERT INTO customers (first_name,last_name, phone_number, latitude, longitude) VALUES (?,?,?,?,?)";

        const [result] = await conn.query(sql, [
            customer.first_name,
            customer.last_name,
            customer.phone_number,
            customer.latitude,
            customer.longitude,

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

        const [result] = await conn.query("DELETE FROM customers WHERE customer_id = ?", [id]);
        const deleteResult = result as any;

        if (deleteResult.affectedRows === 0) {
            return res.status(404).json({ error: "Customer not found" });
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

    let customer: CostomerPostRequest = req.body;

    let sql = conn.format(
        "SELECT * FROM customers WHERE customer_id = ?",
        [id]
    );

    let [response] = await conn.query(sql);

    let result = response as Customer[];

    if (result.length > 0) {

        let customerOriginal = result[0];

        let updateCustomer = {
            ...customerOriginal,
            ...customer
        };

        sql = `
            UPDATE customers
            SET first_name = ?,
                last_name = ?,
                phone_number = ?,
                latitude = ?,
                longitude = ?
            WHERE customer_id = ?
        `;

        sql = conn.format(sql, [
            updateCustomer.first_name,
            updateCustomer.last_name,
            updateCustomer.phone_number,
            updateCustomer.latitude,
            updateCustomer.longitude,
            id
        ]);

        const [records] = await conn.query(sql);

        const updateResult = records as any;

        res.status(200).json({
            affected_row: updateResult.affectedRows
        });

    } else {

        res.status(404).json({
            message: "Customer not found"
        });
    }
});