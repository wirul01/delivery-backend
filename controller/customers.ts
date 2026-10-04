import express from "express";
import { conn } from "../dbconnect";
import { CostomerPostRequest, Customer } from "../model/customers";


export const router = express.Router();


router.get("/search", async (req, res) => {
    try {
        const [rows] = await conn.query(
            "SELECT * FROM customers WHERE (customer_id IS NULL OR customer_id = ?) OR (first_name IS NULL OR first_name LIKE ?) OR (last_name IS NULL OR last_name LIKE ?)",
            [req.query.id, "%" + req.query.name + "%", "%" + req.query.last + "%"]
        );
        res.json(rows);
    } catch (error) {
        // ดักจับ Error กรณีทำงานผิดพลาด เพื่อไม่ให้ระบบหลังบ้านพังล่มไปดื้อๆ
        res.status(500).json({ error: "Internal server error" });
    }
});


router.get("/", async (req, res) => {
    const [rows] = await conn.query("SELECT * FROM customers");
    let customers = rows as Customer[];
    res.json(customers);
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


//elete
router.delete("/:id", async (req, res) => {
    try {
        let id = req.params.id;
        const [result] = await conn.query("DELETE FROM customers WHERE customer_id = ?", [id]);
        const deleteResult = result as any;

        // ตรวจเช็กสักนิดว่ามีแถวถูกลบจริงไหม หากไม่มีแสดงว่าไม่พบไอดีในฐานข้อมูล ส่งกลับรหัส 404
        if (deleteResult.affectedRows === 0) {
            return res.status(404).json({ error: "customer not found" });
        }

        res.status(200).json({ affected_row: deleteResult.affectedRows });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
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