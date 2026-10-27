// routing.ts — ตัวคำนวณเส้นทางและแบ่งงานไรเดอร์
// ไม่ยุ่งกับฐานข้อมูล รับออเดอร์ + ค่าตั้งต้นของร้านเข้ามา แล้วคืนแผนการส่งให้
//
// สมมติฐานที่ใช้ (ตามโจทย์):
//  - ไรเดอร์ทุกคนออกจากร้านเวลา dispatch_time และ "ไม่ต้องขับกลับร้าน"
//  - ระยะทางถนน = ระยะเส้นตรง (Haversine) x distance_multiplier
//  - ค่าส่งของรอบ = ค่าจ้างต่อรอบ + (บาทต่อกม. x ระยะทางทั้งรอบ x จำนวนกล่องทั้งรอบ)
//  - เวลาถึงจุดที่ k = เวลาเริ่มส่ง + ระยะทางสะสม / ความเร็ว + เวลาแวะส่งของจุดก่อนหน้า
//  - ไรเดอร์เรียกได้ไม่จำกัดจำนวน (ถ้าอยากจำกัด ส่ง maxTrips เข้ามา)

export type OptimizationGoal = "MIN_COST" | "MIN_DISTANCE" | "MIN_TIME";

export interface PlanConfig {
    store_latitude: number;
    store_longitude: number;
    rider_base_wage: number;
    wage_per_km_per_meal: number;
    avg_speed_kmh: number;
    dropoff_duration_min: number;
    max_dropoffs_per_trip: number;
    dispatch_time: string;       // "HH:MM:SS"
    delivery_deadline: string;   // "HH:MM:SS"
    max_distance_km: number;
    distance_multiplier: number;
}

export interface PlanOrder {
    order_id: number;
    quantity: number;
    latitude: number;
    longitude: number;
}

export interface PlannedStop {
    order_id: number;
    stop_sequence: number;
    leg_distance_meters: number;
    cumulative_distance_meters: number;
    arrival_time: string;        // "HH:MM:SS"
}

export interface PlannedTrip {
    trip_number: number;
    stops: PlannedStop[];
    meal_count: number;
    trip_distance_meters: number;
    estimated_duration_min: number;
    completion_time: string;     // เวลาที่ถึงจุดสุดท้าย
    delivery_wage: number;
}

export interface UnassignedOrder {
    order_id: number;
    reason: string;
}

export interface PlanResult {
    algorithm_name: string;
    trips: PlannedTrip[];
    unassigned: UnassignedOrder[];
}

// error ที่เกิดจากข้อมูลที่ส่งมาคำนวณไม่ได้ (controller จะตอบ 400)
export class PlanError extends Error { }

// ---------- ฟังก์ชันช่วยเรื่องเวลาและระยะทาง ----------

export function timeToMinutes(t: string): number {
    const parts = t.split(":").map(Number);
    return parts[0]! * 60 + parts[1]! + (parts[2] || 0) / 60;
}

export function minutesToTime(min: number): string {
    const total = Math.round(min * 60);
    const h = Math.floor(total / 3600) % 24;
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(h)}:${two(m)}:${two(s)}`;
}

// ระยะเส้นตรงระหว่าง 2 พิกัด (กม.)
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

// ตัวสุ่มแบบกำหนด seed ได้ (ผลลัพธ์ของข้อมูลชุดเดิมจะได้เหมือนเดิมทุกครั้ง)
function makeRandom(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function permutations(items: number[]): number[][] {
    if (items.length <= 1) return [items.slice()];
    const out: number[][] = [];
    for (let i = 0; i < items.length; i++) {
        const rest = items.slice(0, i).concat(items.slice(i + 1));
        for (const p of permutations(rest)) out.push([items[i]!].concat(p));
    }
    return out;
}

// เปรียบเทียบเวกเตอร์ทีละช่อง (น้อยกว่า = ดีกว่า)
function compare(a: number[], b: number[]): number {
    for (let i = 0; i < a.length; i++) {
        if (a[i]! < b[i]! - EPS) return -1;
        if (a[i]! > b[i]! + EPS) return 1;
    }
    return 0;
}

interface TripEval {
    seq: number[];        // ลำดับออเดอร์ (index ใน list)
    meals: number;
    distM: number;
    completion: number;   // นาทีนับจากเที่ยงคืน ที่ถึงจุดสุดท้าย
    wage: number;
    late: number;         // นาทีที่เกินเวลาส่งถึงเป้าหมาย
}

// ---------- ตัวคำนวณหลัก ----------

export function planRoutes(
    orders: PlanOrder[],
    config: PlanConfig,
    goal: OptimizationGoal,
    options: { maxTrips?: number; restarts?: number } = {}
): PlanResult {
    if (!(config.avg_speed_kmh > 0)) {
        throw new PlanError("ความเร็วเฉลี่ยต้องมากกว่า 0");
    }

    const maxStops = Math.max(1, Math.min(3, Math.floor(config.max_dropoffs_per_trip)));
    const dispatchMin = timeToMinutes(config.dispatch_time);
    const deadlineMin = timeToMinutes(config.delivery_deadline);
    const algorithmName = "GREEDY+LOCAL_SEARCH";

    // 1. ออเดอร์ที่อยู่ไกลเกินระยะส่งสูงสุด ไม่นำมาจัดเส้นทาง
    const unassigned: UnassignedOrder[] = [];
    const list: PlanOrder[] = [];
    for (const o of orders) {
        const d = haversineKm(config.store_latitude, config.store_longitude, o.latitude, o.longitude);
        if (d > config.max_distance_km) {
            unassigned.push({
                order_id: o.order_id,
                reason: `อยู่ไกลเกินระยะส่งสูงสุด ${config.max_distance_km} กม. (ห่างร้าน ${d.toFixed(2)} กม.)`
            });
        } else {
            list.push(o);
        }
    }

    const n = list.length;
    if (n === 0) {
        return { algorithm_name: algorithmName, trips: [], unassigned };
    }

    const maxTrips = options.maxTrips;
    if (maxTrips !== undefined) {
        if (!(maxTrips >= 1)) throw new PlanError("จำนวนไรเดอร์ต้องอย่างน้อย 1 คน");
        if (maxTrips * maxStops < n) {
            throw new PlanError(
                `ไรเดอร์ ${maxTrips} คน รับได้สูงสุด ${maxTrips * maxStops} ออเดอร์ แต่มี ${n} ออเดอร์ที่ต้องส่ง`
            );
        }
    }

    // 2. ตารางระยะทาง (เมตร) จุด 0 = ร้าน, จุด i+1 = ออเดอร์ลำดับที่ i
    const pts = [{ lat: config.store_latitude, lng: config.store_longitude }].concat(
        list.map((o) => ({ lat: o.latitude, lng: o.longitude }))
    );
    const D: number[][] = pts.map((a) =>
        pts.map((b) => Math.round(haversineKm(a.lat, a.lng, b.lat, b.lng) * config.distance_multiplier * 1000))
    );

    // 3. คำนวณ 1 รอบที่ส่งตามลำดับที่กำหนด
    function evalSeq(seq: number[]): TripEval {
        let cum = 0;
        let prev = 0;
        let meals = 0;
        let completion = dispatchMin;
        for (let k = 0; k < seq.length; k++) {
            const node = seq[k]! + 1;
            cum += D[prev]![node]!;
            prev = node;
            meals += list[seq[k]!]!.quantity;
            completion = dispatchMin + (cum / 1000 / config.avg_speed_kmh) * 60 + k * config.dropoff_duration_min;
        }
        const wage = round2(config.rider_base_wage + config.wage_per_km_per_meal * (cum / 1000) * meals);
        return { seq, meals, distM: cum, completion, wage, late: Math.max(0, completion - deadlineMin) };
    }

    // ค่าที่ใช้เทียบ "รอบเดียว" ตามเป้าหมาย (ใช้เลือกลำดับจุดส่งภายในรอบ)
    function tripKey(e: TripEval): number[] {
        if (goal === "MIN_COST") return [e.late, e.wage, e.distM];
        if (goal === "MIN_DISTANCE") return [e.late, e.distM, e.wage];
        return [e.late, e.completion, e.wage];
    }

    // ลำดับจุดส่งที่ดีที่สุดของกลุ่มออเดอร์ (จำ ผลไว้ ไม่ต้องคิดซ้ำ)
    const memo = new Map<string, TripEval>();
    function bestTrip(set: number[]): TripEval {
        const key = set.slice().sort((a, b) => a - b).join(",");
        const hit = memo.get(key);
        if (hit) return hit;
        let best: TripEval | null = null;
        for (const p of permutations(set)) {
            const e = evalSeq(p);
            if (best === null || compare(tripKey(e), tripKey(best)) < 0) best = e;
        }
        memo.set(key, best!);
        return best!;
    }

    // ค่าของ "แผนทั้งหมด" (น้อยกว่า = ดีกว่า) ช่องแรกคือเวลาที่ส่งเกินกำหนด ต้องเป็น 0 ก่อนเสมอ
    function objective(groups: number[][]): number[] {
        const evals = groups.map(bestTrip);
        let late = 0, wage = 0, dist = 0, sumDone = 0, maxDone = 0;
        for (const e of evals) {
            late += e.late;
            wage += e.wage;
            dist += e.distM;
            sumDone += e.completion;
            maxDone = Math.max(maxDone, e.completion);
        }
        if (goal === "MIN_COST") return [late, wage, dist];
        if (goal === "MIN_DISTANCE") return [late, dist, wage];
        return [late, maxDone, sumDone, wage];
    }

    // 4. ปรับแผนทีละน้อย: ย้ายออเดอร์ไปรอบอื่น/แยกเป็นรอบใหม่ หรือสลับออเดอร์ระหว่างรอบ
    //    เลือกการเปลี่ยนที่ดีที่สุดในแต่ละรอบ ทำจนไม่มีอะไรดีขึ้น
    function improve(start: number[][]): { groups: number[][]; obj: number[] } {
        let groups = start.map((g) => g.slice());
        let current = objective(groups);

        for (let pass = 0; pass < 200; pass++) {
            let bestGroups: number[][] | null = null;
            let bestObj = current;

            const tryCandidate = (cand: number[][]) => {
                const clean = cand.filter((g) => g.length > 0);
                const o = objective(clean);
                if (compare(o, bestObj) < 0) {
                    bestObj = o;
                    bestGroups = clean;
                }
            };

            // ย้าย 1 ออเดอร์
            for (let a = 0; a < groups.length; a++) {
                for (let pos = 0; pos < groups[a]!.length; pos++) {
                    const idx = groups[a]![pos]!;
                    for (let b = 0; b < groups.length; b++) {
                        if (b === a || groups[b]!.length >= maxStops) continue;
                        const cand = groups.map((g) => g.slice());
                        cand[a]!.splice(pos, 1);
                        cand[b]!.push(idx);
                        tryCandidate(cand);
                    }
                    // แยกออกเป็นรอบใหม่
                    if (groups[a]!.length > 1 && (maxTrips === undefined || groups.length < maxTrips)) {
                        const cand = groups.map((g) => g.slice());
                        cand[a]!.splice(pos, 1);
                        cand.push([idx]);
                        tryCandidate(cand);
                    }
                }
            }

            // สลับออเดอร์ระหว่าง 2 รอบ
            for (let a = 0; a < groups.length; a++) {
                for (let b = a + 1; b < groups.length; b++) {
                    for (let i = 0; i < groups[a]!.length; i++) {
                        for (let j = 0; j < groups[b]!.length; j++) {
                            const cand = groups.map((g) => g.slice());
                            const tmp = cand[a]![i]!;
                            cand[a]![i] = cand[b]![j]!;
                            cand[b]![j] = tmp;
                            tryCandidate(cand);
                        }
                    }
                }
            }

            if (bestGroups === null) break;
            groups = bestGroups;
            current = bestObj;
        }
        return { groups, obj: current };
    }

    // 5. แผนเริ่มต้นหลายแบบ แล้วเลือกแผนที่ดีที่สุดหลังปรับ
    const chunk = (order: number[]): number[][] => {
        const out: number[][] = [];
        for (let i = 0; i < order.length; i += maxStops) out.push(order.slice(i, i + maxStops));
        return out;
    };
    const all = list.map((_, i) => i);
    const bearing = (i: number) => Math.atan2(pts[i + 1]!.lng - pts[0]!.lng, pts[i + 1]!.lat - pts[0]!.lat);

    const starts: number[][][] = [];

    // 5.1 เรียงตามทิศรอบร้าน แล้วแบ่งทีละ maxStops
    starts.push(chunk(all.slice().sort((a, b) => bearing(a) - bearing(b))));

    // 5.2 เริ่มจากออเดอร์ที่ไกลร้านสุด แล้วเอาออเดอร์ที่อยู่ใกล้ที่สุดมารวมกลุ่ม
    {
        const rest = new Set(all);
        const groups: number[][] = [];
        while (rest.size > 0) {
            let seed = -1;
            for (const i of rest) if (seed === -1 || D[0]![i + 1]! > D[0]![seed + 1]!) seed = i;
            rest.delete(seed);
            const g = [seed];
            while (g.length < maxStops && rest.size > 0) {
                let near = -1;
                for (const i of rest) if (near === -1 || D[seed + 1]![i + 1]! < D[seed + 1]![near + 1]!) near = i;
                rest.delete(near);
                g.push(near);
            }
            groups.push(g);
        }
        starts.push(groups);
    }

    // 5.3 ส่งทีละออเดอร์ (ถ้าจำนวนรอบไม่ติดเพดาน)
    if (maxTrips === undefined || n <= maxTrips) {
        starts.push(all.map((i) => [i]));
    }

    // 5.4 สุ่มเริ่มต้นเพิ่มอีกหลายแบบ
    const rand = makeRandom(n * 7919 + list.reduce((s, o) => s + o.order_id, 0));
    const restarts = options.restarts ?? (n <= 12 ? 12 : 4);
    for (let r = 0; r < restarts; r++) {
        const shuffled = all.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = shuffled[i]!;
            shuffled[i] = shuffled[j]!;
            shuffled[j] = t;
        }
        starts.push(chunk(shuffled));
    }

    let best: { groups: number[][]; obj: number[] } | null = null;
    for (const s of starts) {
        const result = improve(s);
        if (best === null || compare(result.obj, best.obj) < 0) best = result;
    }

    // 6. แปลงเป็นรูปแบบผลลัพธ์ เรียงรอบตามทิศรอบร้านให้เลขรอบเป็นระเบียบ
    const finalTrips = best!.groups
        .map(bestTrip)
        .sort((a, b) => bearing(a.seq[0]!) - bearing(b.seq[0]!));

    const trips: PlannedTrip[] = finalTrips.map((e, t) => {
        const stops: PlannedStop[] = [];
        let prev = 0;
        let cum = 0;
        for (let k = 0; k < e.seq.length; k++) {
            const node = e.seq[k]! + 1;
            const leg = D[prev]![node]!;
            cum += leg;
            prev = node;
            const arrival = dispatchMin + (cum / 1000 / config.avg_speed_kmh) * 60 + k * config.dropoff_duration_min;
            stops.push({
                order_id: list[e.seq[k]!]!.order_id,
                stop_sequence: k + 1,
                leg_distance_meters: leg,
                cumulative_distance_meters: cum,
                arrival_time: minutesToTime(arrival)
            });
        }
        return {
            trip_number: t + 1,
            stops,
            meal_count: e.meals,
            trip_distance_meters: e.distM,
            estimated_duration_min: Math.round((e.completion - dispatchMin) * 10) / 10,
            completion_time: stops[stops.length - 1]!.arrival_time,
            delivery_wage: e.wage
        };
    });

    return { algorithm_name: algorithmName, trips, unassigned };
}
