import { serverErrorBody } from "../errorText";
import express from "express";
import { conn } from "../dbconnect";
import { DeliveredRequest, RiderJob, RiderJobStop } from "../model/courier_trips";

export const router = express.Router();

// ลิงก์ Google Maps (เปิดในมือถือของไรเดอร์ได้เลย)
function pointText(lat: number, lng: number): string {
    return `${lat},${lng}`;
}

// ดึงใบงานจากรหัส 8 ตัว (ใช้ทั้งตอนเปิดใบงาน และตอนตอบกลับหลังกดยืนยันส่ง)
// คืน null ถ้าไม่พบรหัส หรือแผนไม่ได้อยู่ในสถานะ LOCKED
async function loadJob(code: string): Promise<RiderJob | null> {
    // เอาเฉพาะรอบที่ยืนยันแล้ว (LOCKED) เท่านั้น ถ้าแผนถูกยกเลิก รหัสจะใช้ไม่ได้
    const [tRows] = await conn.query(
        `SELECT ct.trip_id, ct.trip_number, ct.route_color, ct.stop_count, ct.meal_count,
                ct.trip_distance_meters, ct.completion_time, ct.delivery_wage,
                DATE_FORMAT(rs.session_date, '%Y-%m-%d') AS session_date, rs.config_snapshot
         FROM courier_trips ct
         JOIN routing_sessions rs ON rs.session_id = ct.session_id
         WHERE ct.trip_access_code = ? AND rs.session_status = 'LOCKED'`,
        [code]
    );
    const trips = tRows as any[];
    if (trips.length === 0) {
        return null;
    }
    const trip = trips[0];
    const snapshot = typeof trip.config_snapshot === "string" ? JSON.parse(trip.config_snapshot) : trip.config_snapshot;

    // delivered_at แปลงเป็นเวลาแบบ unix (วินาที) ใน SQL เลย เพื่อไม่ให้เวลาเพี้ยนตามเขตเวลาของเครื่อง
    const [nRows] = await conn.query(
        `SELECT tn.stop_sequence, tn.estimated_arrival_time, UNIX_TIMESTAMP(tn.delivered_at) AS delivered_unix,
                mo.order_number, mo.quantity, mo.delivery_latitude, mo.delivery_longitude,
                b.first_name, b.last_name, b.phone_number
         FROM trip_nodes tn
         JOIN meal_orders mo ON mo.order_id = tn.order_id
         LEFT JOIN buyers b ON b.buyer_id = mo.buyer_id
         WHERE tn.trip_id = ?
         ORDER BY tn.stop_sequence`,
        [trip.trip_id]
    );

    const storeLat = Number(snapshot.store_latitude);
    const storeLng = Number(snapshot.store_longitude);

    let stops: RiderJobStop[] = (nRows as any[]).map((n) => {
        const lat = Number(n.delivery_latitude);
        const lng = Number(n.delivery_longitude);
        return {
            stop_sequence: n.stop_sequence,
            order_number: n.order_number,
            customer_name: `${n.first_name ?? ""} ${n.last_name ?? ""}`.trim(),
            phone_number: n.phone_number,
            quantity: n.quantity,
            latitude: lat,
            longitude: lng,
            estimated_arrival_time: n.estimated_arrival_time,
            delivered_at: n.delivered_unix === null ? null : new Date(Number(n.delivered_unix) * 1000).toISOString(),
            map_url: `https://www.google.com/maps/search/?api=1&query=${pointText(lat, lng)}`,
        };
    });

    // เส้นทางทั้งรอบ: ร้าน -> จุดสุดท้ายเป็นปลายทาง จุดก่อนหน้าเป็นจุดแวะ
    const last = stops[stops.length - 1]!;
    let routeUrl =
        `https://www.google.com/maps/dir/?api=1&origin=${pointText(storeLat, storeLng)}` +
        `&destination=${pointText(last.latitude, last.longitude)}&travelmode=two-wheeler`;
    if (stops.length > 1) {
        const waypoints = stops.slice(0, -1).map((s) => pointText(s.latitude, s.longitude)).join("|");
        routeUrl += `&waypoints=${encodeURIComponent(waypoints)}`;
    }

    const summary =
        `ออกจากร้าน ${snapshot.dispatch_time} รับข้าวกล่อง ${trip.meal_count} กล่อง → ` +
        stops.map((s) => `จุดที่ ${s.stop_sequence} (${s.order_number} ${s.quantity} กล่อง)`).join(" → ");

    let delivered = stops.filter((s) => s.delivered_at !== null).length;

    let job: RiderJob = {
        trip_number: trip.trip_number,
        session_date: trip.session_date,
        route_color: trip.route_color,
        total_meals: trip.meal_count,
        stop_count: trip.stop_count,
        delivered_count: delivered,
        dispatch_time: snapshot.dispatch_time,
        delivery_deadline: snapshot.delivery_deadline,
        completion_time: trip.completion_time,
        trip_distance_meters: trip.trip_distance_meters,
        delivery_wage: Number(trip.delivery_wage),
        store: { name: snapshot.store_name, latitude: storeLat, longitude: storeLng },
        summary: summary,
        route_map_url: routeUrl,
        stops: stops,
    };

    return job;
}

// ใบงานไรเดอร์: เปิดด้วยรหัส 8 ตัวที่ได้ตอนแอดมินกดยืนยันรอบ (ไม่ต้องล็อกอิน)
// GET /courier_trips/code/ABCD2345
router.get("/code/:code", async (req, res) => {
    try {
        const code = String(req.params.code).trim().toUpperCase();

        let job = await loadJob(code);
        if (job === null) {
            return res.status(404).json({ error: "ไม่พบใบงานนี้ หรือแผนถูกยกเลิกแล้ว" });
        }

        res.json(job);
    } catch (error) {
        console.error(error);
        res.status(500).json(serverErrorBody(error));
    }
});

// ไรเดอร์กดยืนยันว่า "ส่งจุดนี้เสร็จแล้ว" (หรือกดยกเลิกการยืนยัน ถ้ากดผิด)
// PATCH /courier_trips/code/ABCD2345/stops/2/delivered   body: { "delivered": true }  (ไม่ส่ง = true)
// ตอบกลับเป็นใบงานล่าสุด
router.patch("/code/:code/stops/:seq/delivered", async (req, res) => {
    try {
        const code = String(req.params.code).trim().toUpperCase();
        const seq = +req.params.seq;
        let body: DeliveredRequest = req.body ?? {};

        if (body.delivered !== undefined && typeof body.delivered !== "boolean") {
            return res.status(400).json({ error: "delivered ต้องเป็น true หรือ false" });
        }
        const delivered = body.delivered ?? true;

        let job = await loadJob(code);
        if (job === null) {
            return res.status(404).json({ error: "ไม่พบใบงานนี้ หรือแผนถูกยกเลิกแล้ว" });
        }
        if (!job.stops.some((s) => s.stop_sequence === seq)) {
            return res.status(404).json({ error: "ไม่พบจุดส่งนี้ในใบงาน" });
        }

        // ยืนยันซ้ำไม่เปลี่ยนเวลาเดิม (COALESCE เก็บเวลาที่กดครั้งแรกไว้)
        let sql = delivered
            ? `UPDATE trip_nodes tn
               JOIN courier_trips ct ON ct.trip_id = tn.trip_id
               SET tn.delivered_at = COALESCE(tn.delivered_at, NOW())
               WHERE ct.trip_access_code = ? AND tn.stop_sequence = ?`
            : `UPDATE trip_nodes tn
               JOIN courier_trips ct ON ct.trip_id = tn.trip_id
               SET tn.delivered_at = NULL
               WHERE ct.trip_access_code = ? AND tn.stop_sequence = ?`;
        await conn.query(sql, [code, seq]);

        res.json(await loadJob(code));
    } catch (error) {
        console.error(error);
        res.status(500).json(serverErrorBody(error));
    }
});
