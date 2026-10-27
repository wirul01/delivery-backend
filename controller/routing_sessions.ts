import { serverErrorBody } from "../errorText";
import express from "express";
import { randomInt } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { conn } from "../dbconnect";
import {
    CalculateRequest,
    CourierTripDetail,
    RoutingSession,
    RoutingSessionDetail,
    UnassignedOrderDetail,
} from "../model/routing_sessions";
import {
    OptimizationGoal,
    PlanConfig,
    PlanError,
    PlanOrder,
    haversineKm,
    minutesToTime,
    planRoutes,
    timeToMinutes,
} from "../routing";

export const router = express.Router();

// สีเส้นทางของแต่ละรอบ (รอบที่ 1 แดง, 2 เขียว, 3 น้ำเงิน, ...) ถ้ารอบเกิน 12 จะวนกลับมาใช้สีเดิม
const ROUTE_COLORS = [
    "#E53935", "#43A047", "#1E88E5", "#FB8C00", "#8E24AA", "#00897B",
    "#D81B60", "#6D4C41", "#3949AB", "#7CB342", "#00ACC1", "#546E7A",
];

const GOALS = ["MIN_COST", "MIN_DISTANCE", "MIN_TIME"];

// คอลัมน์ของ routing_sessions ที่ส่งออกไป (วันที่แปลงเป็น yyyy-MM-dd)
const SESSION_COLUMNS =
    "session_id, DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date, session_status, optimization_goal, iteration_number, algorithm_name, total_orders, total_meals, total_couriers, total_distance_meters, latest_delivery_time, total_revenue, total_meal_cost, total_delivery_cost, net_profit, is_deadline_met, processing_time_ms, created_by_admin_id, created_at, locked_at";

// รหัสใบงาน 8 ตัว ไม่ใช้ตัวที่อ่านสับสน (0 O 1 I)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += CODE_CHARS.charAt(randomInt(CODE_CHARS.length));
    }
    return code;
}

// DECIMAL ของ mysql2 มาเป็นข้อความ แปลงเป็นตัวเลขก่อนส่งออก
function toSession(row: any): RoutingSession {
    return {
        ...row,
        total_revenue: Number(row.total_revenue),
        total_meal_cost: Number(row.total_meal_cost),
        total_delivery_cost: Number(row.total_delivery_cost),
        net_profit: Number(row.net_profit),
    } as RoutingSession;
}

// ดึงผลการคำนวณ 1 ครั้ง พร้อมรอบ จุดส่ง และออเดอร์ที่ยังไม่อยู่ในแผน
async function loadSessionDetail(id: number): Promise<RoutingSessionDetail | null> {
    const [sRows] = await conn.query(
        `SELECT ${SESSION_COLUMNS}, config_snapshot FROM routing_sessions WHERE session_id = ?`,
        [id]
    );
    const sessions = sRows as any[];
    if (sessions.length === 0) {
        return null;
    }

    const { config_snapshot, ...sessionRow } = sessions[0];
    const snapshot = typeof config_snapshot === "string" ? JSON.parse(config_snapshot) : config_snapshot;

    const [tRows] = await conn.query(
        "SELECT * FROM courier_trips WHERE session_id = ? ORDER BY trip_number",
        [id]
    );
    const [nRows] = await conn.query(
        `SELECT tn.trip_id, tn.order_id, tn.stop_sequence, tn.leg_distance_meters, tn.cumulative_distance_meters, tn.estimated_arrival_time,
                UNIX_TIMESTAMP(tn.delivered_at) AS delivered_unix,
                mo.order_number, mo.quantity, mo.delivery_latitude, mo.delivery_longitude,
                b.first_name, b.last_name, b.phone_number
         FROM trip_nodes tn
         JOIN courier_trips ct ON ct.trip_id = tn.trip_id
         JOIN meal_orders mo ON mo.order_id = tn.order_id
         LEFT JOIN buyers b ON b.buyer_id = mo.buyer_id
         WHERE ct.session_id = ?
         ORDER BY ct.trip_number, tn.stop_sequence`,
        [id]
    );

    const nodes = nRows as any[];
    const trips: CourierTripDetail[] = (tRows as any[]).map((t) => ({
        trip_id: t.trip_id,
        trip_number: t.trip_number,
        courier_id: t.courier_id,
        route_color: t.route_color,
        trip_access_code: t.trip_access_code,
        stop_count: t.stop_count,
        meal_count: t.meal_count,
        trip_distance_meters: t.trip_distance_meters,
        estimated_duration_min: Number(t.estimated_duration_min),
        completion_time: t.completion_time,
        delivery_wage: Number(t.delivery_wage),
        nodes: nodes
            .filter((n) => n.trip_id === t.trip_id)
            .map((n) => ({
                order_id: n.order_id,
                order_number: n.order_number,
                stop_sequence: n.stop_sequence,
                leg_distance_meters: n.leg_distance_meters,
                cumulative_distance_meters: n.cumulative_distance_meters,
                estimated_arrival_time: n.estimated_arrival_time,
                delivered_at: n.delivered_unix === null ? null : new Date(Number(n.delivered_unix) * 1000).toISOString(),
                quantity: n.quantity,
                customer_name: `${n.first_name ?? ""} ${n.last_name ?? ""}`.trim(),
                phone_number: n.phone_number,
                latitude: Number(n.delivery_latitude),
                longitude: Number(n.delivery_longitude),
            })),
    }));

    // ออเดอร์ของวันนั้นที่ยังรอส่งแต่ไม่ได้อยู่ในแผนนี้
    const [uRows] = await conn.query(
        `SELECT mo.order_id, mo.order_number, mo.quantity, mo.delivery_latitude, mo.delivery_longitude
         FROM meal_orders mo
         WHERE mo.target_date = (SELECT session_date FROM routing_sessions WHERE session_id = ?)
           AND mo.order_status = 'QUEUED'
           AND mo.order_id NOT IN (
               SELECT tn.order_id FROM trip_nodes tn
               JOIN courier_trips ct ON ct.trip_id = tn.trip_id
               WHERE ct.session_id = ?
           )
         ORDER BY mo.order_id`,
        [id, id]
    );

    const unassigned: UnassignedOrderDetail[] = (uRows as any[]).map((o) => {
        const lat = Number(o.delivery_latitude);
        const lng = Number(o.delivery_longitude);
        const d = haversineKm(Number(snapshot.store_latitude), Number(snapshot.store_longitude), lat, lng);
        return {
            order_id: o.order_id,
            order_number: o.order_number,
            quantity: o.quantity,
            latitude: lat,
            longitude: lng,
            reason:
                d > Number(snapshot.max_distance_km)
                    ? `อยู่ไกลเกินระยะส่งสูงสุด ${snapshot.max_distance_km} กม. (ห่างร้าน ${d.toFixed(2)} กม.)`
                    : "ออเดอร์นี้เพิ่มเข้ามาหลังคำนวณ กรุณาคำนวณใหม่",
        };
    });

    return {
        session: toSession(sessionRow),
        store: {
            name: snapshot.store_name,
            latitude: Number(snapshot.store_latitude),
            longitude: Number(snapshot.store_longitude),
            dispatch_time: snapshot.dispatch_time,
            delivery_deadline: snapshot.delivery_deadline,
            max_distance_km: Number(snapshot.max_distance_km),
        },
        trips,
        unassigned,
    };
}

// POST /routing_sessions/calculate
// สั่งคำนวณเส้นทางจากออเดอร์ที่ QUEUED ของวันนั้น (บันทึกเป็นแบบร่าง DRAFT ยังไม่ยืนยัน)
// ถ้าไม่พอใจ สั่งคำนวณใหม่ได้ (เปลี่ยนเป้าหมายได้) แบบร่างเก่าของวันเดียวกันจะถูกเปลี่ยนเป็น VOIDED
router.post("/calculate", async (req, res) => {
    let db: PoolConnection | null = null;

    try {
        const startTime = Date.now();
        let body: CalculateRequest = req.body ?? {};

        // 1. ตรวจข้อมูลที่ส่งมา
        const goal = (body.optimization_goal ?? "MIN_COST") as OptimizationGoal;
        if (!GOALS.includes(goal)) {
            return res.status(400).json({ error: "optimization_goal ต้องเป็น MIN_COST, MIN_DISTANCE หรือ MIN_TIME" });
        }

        let targetDate = body.target_date;
        if (targetDate === undefined) {
            // ไม่ส่งวันที่มา = ใช้วันนี้ตามเวลาของฐานข้อมูล (เหมือนที่ /meal_orders/seed ใช้)
            const [dRows] = await conn.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d");
            targetDate = (dRows as any[])[0].d as string;
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
            return res.status(400).json({ error: "target_date ต้องอยู่ในรูปแบบ yyyy-MM-dd เช่น 2026-10-27" });
        }

        let maxCouriers: number | undefined = undefined;
        if (body.max_couriers !== undefined) {
            maxCouriers = Number(body.max_couriers);
            if (!Number.isInteger(maxCouriers) || maxCouriers < 1) {
                return res.status(400).json({ error: "max_couriers ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป" });
            }
        }

        // 2. ค่าตั้งต้นของร้าน
        const [cfgRows] = await conn.query("SELECT * FROM store_preferences WHERE config_id = 1");
        const cfgList = cfgRows as any[];
        if (cfgList.length === 0) {
            return res.status(400).json({ error: "ยังไม่มีข้อมูลตั้งค่าร้าน (store_preferences)" });
        }
        const cfg = cfgList[0];
        const config: PlanConfig = {
            store_latitude: Number(cfg.store_latitude),
            store_longitude: Number(cfg.store_longitude),
            rider_base_wage: Number(cfg.rider_base_wage),
            wage_per_km_per_meal: Number(cfg.wage_per_km_per_meal),
            avg_speed_kmh: Number(cfg.avg_speed_kmh),
            dropoff_duration_min: Number(cfg.dropoff_duration_min),
            max_dropoffs_per_trip: Number(cfg.max_dropoffs_per_trip),
            dispatch_time: cfg.dispatch_time,
            delivery_deadline: cfg.delivery_deadline,
            max_distance_km: Number(cfg.max_distance_km),
            distance_multiplier: Number(cfg.distance_multiplier),
        };

        // 3. ผู้สั่งคำนวณ (ยังไม่มีระบบล็อกอินจริง ถ้าไม่ส่ง admin_id มา ใช้ผู้ดูแลคนแรก)
        let adminId = body.admin_id;
        if (adminId === undefined) {
            const [aRows] = await conn.query("SELECT admin_id FROM system_admins ORDER BY admin_id LIMIT 1");
            const admins = aRows as any[];
            if (admins.length === 0) {
                return res.status(400).json({ error: "ไม่พบผู้ดูแลระบบ (system_admins)" });
            }
            adminId = admins[0].admin_id as number;
        }

        // 4. ออเดอร์ที่รอส่งของวันนั้น
        const [oRows] = await conn.query(
            `SELECT order_id, quantity, selling_price, cost_price, delivery_latitude, delivery_longitude
             FROM meal_orders
             WHERE target_date = ? AND order_status = 'QUEUED'
             ORDER BY order_id`,
            [targetDate]
        );
        const orderRows = oRows as any[];
        if (orderRows.length === 0) {
            return res.status(400).json({ error: `ไม่มีออเดอร์ที่รอส่ง (QUEUED) ของวันที่ ${targetDate}` });
        }

        const planOrders: PlanOrder[] = orderRows.map((o) => ({
            order_id: o.order_id,
            quantity: o.quantity,
            latitude: Number(o.delivery_latitude),
            longitude: Number(o.delivery_longitude),
        }));

        // 5. คำนวณ
        const plan = planRoutes(planOrders, config, goal, maxCouriers === undefined ? {} : { maxTrips: maxCouriers });

        if (plan.trips.length === 0) {
            return res.status(400).json({
                error: "ไม่มีออเดอร์ที่ส่งได้ (ทุกออเดอร์อยู่ไกลเกินระยะส่งสูงสุด)",
                unassigned: plan.unassigned,
            });
        }

        // 6. สรุปตัวเลขของแผน
        const orderById = new Map<number, any>(orderRows.map((o) => [o.order_id as number, o]));
        let totalOrders = 0, totalMeals = 0, totalDistance = 0;
        let revenue = 0, mealCost = 0, deliveryCost = 0, latestMin = 0;
        for (const t of plan.trips) {
            totalMeals += t.meal_count;
            totalDistance += t.trip_distance_meters;
            deliveryCost += t.delivery_wage;
            latestMin = Math.max(latestMin, timeToMinutes(t.completion_time));
            for (const s of t.stops) {
                const o = orderById.get(s.order_id);
                totalOrders++;
                revenue += o.quantity * Number(o.selling_price);
                mealCost += o.quantity * Number(o.cost_price);
            }
        }
        const round2 = (n: number) => Math.round(n * 100) / 100;
        revenue = round2(revenue);
        mealCost = round2(mealCost);
        deliveryCost = round2(deliveryCost);
        const netProfit = round2(revenue - mealCost - deliveryCost);
        const deadlineSec = Math.round(timeToMinutes(config.delivery_deadline) * 60);
        const isDeadlineMet = Math.round(latestMin * 60) <= deadlineSec ? 1 : 0;

        // 7. บันทึกลงฐานข้อมูล (ทำเป็นชุดเดียวกัน ถ้าพลาดกลางทางจะย้อนกลับทั้งหมด)
        db = await conn.getConnection();
        await db.beginTransaction();

        // แบบร่างเก่าของวันเดียวกันเป็นโมฆะ
        await db.query(
            "UPDATE routing_sessions SET session_status = 'VOIDED' WHERE session_date = ? AND session_status = 'DRAFT'",
            [targetDate]
        );

        const [cRows] = await db.query("SELECT COUNT(*) AS c FROM routing_sessions WHERE session_date = ?", [targetDate]);
        const iteration = Number((cRows as any[])[0].c) + 1;

        const [sResult] = await db.query(
            `INSERT INTO routing_sessions
                (session_date, session_status, optimization_goal, iteration_number, algorithm_name, config_snapshot,
                 total_orders, total_meals, total_couriers, total_distance_meters, latest_delivery_time,
                 total_revenue, total_meal_cost, total_delivery_cost, net_profit, is_deadline_met,
                 processing_time_ms, created_by_admin_id)
             VALUES (?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                targetDate,
                goal,
                iteration,
                plan.algorithm_name,
                JSON.stringify({ store_name: cfg.store_name, ...config }),
                totalOrders,
                totalMeals,
                plan.trips.length,
                totalDistance,
                minutesToTime(latestMin),
                revenue,
                mealCost,
                deliveryCost,
                netProfit,
                isDeadlineMet,
                Date.now() - startTime,
                adminId,
            ]
        );
        const sessionId = (sResult as any).insertId as number;

        for (const t of plan.trips) {
            const [tResult] = await db.query(
                `INSERT INTO courier_trips
                    (session_id, trip_number, courier_id, route_color, trip_access_code, stop_count, meal_count,
                     trip_distance_meters, estimated_duration_min, completion_time, delivery_wage)
                 VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?)`,
                [
                    sessionId,
                    t.trip_number,
                    ROUTE_COLORS[(t.trip_number - 1) % ROUTE_COLORS.length],
                    t.stops.length,
                    t.meal_count,
                    t.trip_distance_meters,
                    t.estimated_duration_min,
                    t.completion_time,
                    t.delivery_wage,
                ]
            );
            const tripId = (tResult as any).insertId as number;

            await db.query(
                `INSERT INTO trip_nodes
                    (trip_id, order_id, stop_sequence, leg_distance_meters, cumulative_distance_meters, estimated_arrival_time)
                 VALUES ?`,
                [
                    t.stops.map((s) => [
                        tripId,
                        s.order_id,
                        s.stop_sequence,
                        s.leg_distance_meters,
                        s.cumulative_distance_meters,
                        s.arrival_time,
                    ]),
                ]
            );
        }

        await db.commit();

        res.status(201).json(await loadSessionDetail(sessionId));
    } catch (error: any) {
        if (db) {
            await db.rollback();
        }

        // ข้อมูลที่ส่งมาคำนวณไม่ได้ เช่น จำกัดไรเดอร์น้อยเกินไป
        if (error instanceof PlanError) {
            return res.status(400).json({ error: error.message });
        }
        // admin_id ที่ส่งมาไม่มีในระบบ
        if (error.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ error: "ไม่พบผู้ดูแลระบบ (admin_id) นี้" });
        }

        console.error("🔴 CALCULATE ERROR:", error);
        res.status(500).json(serverErrorBody(error));
    } finally {
        if (db) {
            db.release();
        }
    }
});

// GET /routing_sessions?date=yyyy-MM-dd
// ประวัติการคำนวณ (ใหม่สุดก่อน) ใส่ date เพื่อดูเฉพาะวันนั้น
router.get("/", async (req, res) => {
    try {
        let sql = `SELECT ${SESSION_COLUMNS} FROM routing_sessions`;
        const params: any[] = [];

        if (req.query.date) {
            sql += " WHERE session_date = ?";
            params.push(req.query.date);
        }

        sql += " ORDER BY session_id DESC";
        const [rows] = await conn.query(sql, params);
        res.json((rows as any[]).map(toSession));
    } catch (error) {
        res.status(500).json(serverErrorBody(error));
    }
});

// GET /routing_sessions/:id
// ผลคำนวณเต็ม ใช้วาดแผนที่ (สีเส้นทางต่อรอบ) และสรุปค่าใช้จ่าย/กำไร/เวลา
router.get("/:id", async (req, res) => {
    try {
        const detail = await loadSessionDetail(+req.params.id);

        if (detail === null) {
            return res.status(404).json({ error: "Routing session not found" });
        }

        res.json(detail);
    } catch (error) {
        console.error(error);
        res.status(500).json(serverErrorBody(error));
    }
});

// PATCH /routing_sessions/:id/lock
// ยืนยันแผน: สร้างรหัสใบงาน 8 ตัวให้แต่ละรอบ และเปลี่ยนออเดอร์ในแผนเป็น SHIPPED
router.patch("/:id/lock", async (req, res) => {
    let db: PoolConnection | null = null;

    try {
        const id = +req.params.id;

        const [sRows] = await conn.query("SELECT session_status FROM routing_sessions WHERE session_id = ?", [id]);
        const sessions = sRows as any[];
        if (sessions.length === 0) {
            return res.status(404).json({ error: "Routing session not found" });
        }
        if (sessions[0].session_status !== "DRAFT") {
            return res.status(400).json({ error: `ยืนยันไม่ได้ เพราะรอบนี้อยู่ในสถานะ ${sessions[0].session_status}` });
        }

        // ตรวจว่าออเดอร์ยังตรงกับตอนคำนวณ (ไม่ถูกลบ/แก้จำนวนกล่อง/ส่งไปแล้ว) ถ้าไม่ตรงต้องคำนวณใหม่
        const [cRows] = await conn.query(
            `SELECT ct.trip_id, ct.stop_count, ct.meal_count,
                    COUNT(tn.node_id) AS nodes,
                    COALESCE(SUM(mo.quantity), 0) AS meals,
                    COALESCE(SUM(mo.order_status <> 'QUEUED'), 0) AS not_queued
             FROM courier_trips ct
             LEFT JOIN trip_nodes tn ON tn.trip_id = ct.trip_id
             LEFT JOIN meal_orders mo ON mo.order_id = tn.order_id
             WHERE ct.session_id = ?
             GROUP BY ct.trip_id, ct.stop_count, ct.meal_count`,
            [id]
        );
        for (const c of cRows as any[]) {
            if (Number(c.nodes) !== c.stop_count || Number(c.meals) !== c.meal_count || Number(c.not_queued) > 0) {
                return res.status(409).json({ error: "ออเดอร์มีการเปลี่ยนแปลงหลังคำนวณ กรุณาคำนวณใหม่" });
            }
        }

        db = await conn.getConnection();
        await db.beginTransaction();

        const [tRows] = await db.query("SELECT trip_id FROM courier_trips WHERE session_id = ? ORDER BY trip_number", [id]);
        for (const t of tRows as any[]) {
            // สุ่มรหัสจนกว่าจะไม่ซ้ำกับของเดิม
            let code = generateCode();
            for (let i = 0; i < 20; i++) {
                const [dup] = await db.query("SELECT trip_id FROM courier_trips WHERE trip_access_code = ?", [code]);
                if ((dup as any[]).length === 0) break;
                code = generateCode();
            }
            await db.query("UPDATE courier_trips SET trip_access_code = ? WHERE trip_id = ?", [code, t.trip_id]);
        }

        await db.query(
            `UPDATE meal_orders SET order_status = 'SHIPPED', updated_at = NOW()
             WHERE order_id IN (
                 SELECT tn.order_id FROM trip_nodes tn
                 JOIN courier_trips ct ON ct.trip_id = tn.trip_id
                 WHERE ct.session_id = ?
             )`,
            [id]
        );
        await db.query(
            "UPDATE routing_sessions SET session_status = 'LOCKED', locked_at = NOW() WHERE session_id = ?",
            [id]
        );

        await db.commit();

        res.json(await loadSessionDetail(id));
    } catch (error) {
        if (db) {
            await db.rollback();
        }
        console.error("🔴 LOCK ERROR:", error);
        res.status(500).json(serverErrorBody(error));
    } finally {
        if (db) {
            db.release();
        }
    }
});

// PATCH /routing_sessions/:id/void
// ยกเลิกแผน (ถ้ายืนยันไปแล้ว ออเดอร์ในแผนจะกลับเป็น QUEUED และรหัสใบงานจะใช้ไม่ได้)
router.patch("/:id/void", async (req, res) => {
    let db: PoolConnection | null = null;

    try {
        const id = +req.params.id;

        const [sRows] = await conn.query("SELECT session_status FROM routing_sessions WHERE session_id = ?", [id]);
        const sessions = sRows as any[];
        if (sessions.length === 0) {
            return res.status(404).json({ error: "Routing session not found" });
        }
        const status = sessions[0].session_status as string;
        if (status === "VOIDED") {
            return res.status(400).json({ error: "รอบนี้ถูกยกเลิกไปแล้ว" });
        }

        db = await conn.getConnection();
        await db.beginTransaction();

        if (status === "LOCKED") {
            await db.query(
                `UPDATE meal_orders SET order_status = 'QUEUED', updated_at = NOW()
                 WHERE order_id IN (
                     SELECT tn.order_id FROM trip_nodes tn
                     JOIN courier_trips ct ON ct.trip_id = tn.trip_id
                     WHERE ct.session_id = ?
                 )`,
                [id]
            );
        }
        await db.query("UPDATE routing_sessions SET session_status = 'VOIDED' WHERE session_id = ?", [id]);

        await db.commit();

        res.json(await loadSessionDetail(id));
    } catch (error) {
        if (db) {
            await db.rollback();
        }
        console.error("🔴 VOID ERROR:", error);
        res.status(500).json(serverErrorBody(error));
    } finally {
        if (db) {
            db.release();
        }
    }
});
