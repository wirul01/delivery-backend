import express, { Request, Response } from "express";
import { conn } from "../dbconnect";
import {
  MealOrders,
  MealOrderPostRequest,
  UpdateQuantityRequest,
  NearbyQueryParams,
} from "../model/meal_orders";

export const router = express.Router();

// คำนวณระยะทาง (km)
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 1. GET: ดึงรายการทั้งหมด / ค้นหาระยะใกล้เคียง (รองรับ 2 กม.)
router.get("/", async (req: Request<{}, {}, {}, NearbyQueryParams>, res: Response) => {
  try {
    const { lat, lng, radiusKm } = req.query;

    const [rows]: any = await conn.query(`
      SELECT mo.*, b.first_name, b.last_name, b.phone_number 
      FROM meal_orders mo
      LEFT JOIN buyers b ON mo.buyer_id = b.buyer_id
      ORDER BY mo.order_id DESC
    `);

    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxRadius = radiusKm ? parseFloat(radiusKm) : 2.0;

      const nearbyOrders = rows
        .map((order: any) => {
          const dist = getDistanceKm(
            userLat,
            userLng,
            parseFloat(order.delivery_latitude),
            parseFloat(order.delivery_longitude)
          );
          return { ...order, distance_km: Number(dist.toFixed(2)) };
        })
        .filter((order: any) => order.distance_km <= maxRadius);

      return res.json(nearbyOrders);
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. POST: สุ่มจำลองข้อมูล 20-30 รายการ
router.post("/seed", async (req: Request, res: Response) => {
  try {
    const [buyers]: any = await conn.query("SELECT buyer_id FROM buyers");
    
    if (!buyers || buyers.length === 0) {
      return res.status(400).json({ 
        error: "กรุณาเพิ่มข้อมูลในตาราง buyers ก่อนสุ่มข้อมูล" 
      });
    }

    const count = Math.floor(Math.random() * 11) + 20; // 20 - 30 รายการ
    const baseLat = 16.1841;
    const baseLng = 103.3005;
    const timestamp = Date.now().toString().slice(-5);

    for (let i = 1; i <= count; i++) {
      const latOffset = (Math.random() - 0.5) * 0.03;
      const lngOffset = (Math.random() - 0.5) * 0.03;
      const randomBuyer = buyers[Math.floor(Math.random() * buyers.length)].buyer_id;

      await conn.query(
        `INSERT INTO meal_orders 
          (order_number, buyer_id, target_date, quantity, selling_price, cost_price, delivery_latitude, delivery_longitude, order_status, created_at, updated_at) 
         VALUES (?, ?, '2026-10-08', 1, 65.00, 40.00, ?, ?, 'QUEUED', NOW(), NOW())`,
        [
          `TKT-${timestamp}-${String(i).padStart(3, "0")}`,
          randomBuyer,
          Number((baseLat + latOffset).toFixed(7)),
          Number((baseLng + lngOffset).toFixed(7)),
        ]
      );
    }

    res.json({ message: `จำลองข้อมูลสำเร็จ ${count} รายการ` });
  } catch (err: any) {
    console.error("🔴 SEED ERROR:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// 3. POST: สร้าง Order ใหม่
router.post("/", async (req: Request<{}, {}, MealOrderPostRequest>, res: Response) => {
  try {
    const body = req.body;
    const [result]: any = await conn.query(
      `INSERT INTO meal_orders 
        (order_number, buyer_id, target_date, quantity, selling_price, cost_price, delivery_latitude, delivery_longitude, creation_type, order_status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        body.order_number,
        body.buyer_id,
        body.target_date,
        body.quantity,
        body.selling_price,
        body.cost_price,          // 👈 เพิ่มอันนี้ที่หายไป
        body.delivery_latitude,   // 👈 เพิ่มอันนี้ที่หายไป
        body.delivery_longitude,
        body.creation_type || "MANUAL",
        body.order_status || "QUEUED",
      ]
    );

    res.status(201).json({ message: "เพิ่มรายการสั่งซื้อสำเร็จ", order_id: result.insertId });
  } catch (err) {
    console.error("🔴 CREATE ORDER ERROR:", err);
    const error = err as any;
    if (error.code === "ER_DUP_ENTRY") {
       res.status(409).json({ error: "Order number already exists" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. PATCH: แก้ไขจำนวนกล่อง
router.patch("/:id/quantity", async (req: Request<{ id: string }, {}, UpdateQuantityRequest>, res: Response) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    const [result]: any = await conn.query(
      "UPDATE meal_orders SET quantity = ?, updated_at = NOW() WHERE order_id = ?",
      [quantity, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบรายการสั่งซื้อ" });
    }

    res.json({ message: "แก้ไขจำนวนกล่องเรียบร้อย" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 5. DELETE: ลบรายการเดียว
router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const [result]: any = await conn.query("DELETE FROM meal_orders WHERE order_id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบรายการสั่งซื้อ" });
    }

    res.json({ message: `ลบออเดอร์ ID: ${id} เรียบร้อย` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 6. DELETE: ล้างทั้งหมด (ใช้ DELETE FROM แทน TRUNCATE)
router.delete("/", async (req: Request, res: Response) => {
  try {
    await conn.query("DELETE FROM meal_orders");

    // (Optional) ถ้าต้องการให้ order_id เริ่มนับ 1 ใหม่
    await conn.query("ALTER TABLE meal_orders AUTO_INCREMENT = 1");

    res.json({ message: "ล้างรายการสั่งซื้อทั้งหมดเรียบร้อยแล้ว" });
  } catch (err) {
    console.error("🔴 CLEAR ORDERS ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});