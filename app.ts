import express from "express";
import { router as index } from "./controller/index";
import { router as buyers } from "./controller/buyers";
import { router as meal_orders } from "./controller/meal_orders"; // เพิ่มการนำเข้า router ของ orders
import cors from 'cors';
import { router as store_preferences } from "./controller/store_preferences";
import { router as couriers } from "./controller/couriers";
import { router as routing_sessions } from "./controller/routing_sessions";
import { router as courier_trips } from "./controller/courier_trips";

export const app = express();


app.use(cors());
app.use(express.json());

app.use("/", index);
app.use("/buyers", buyers);
app.use("/meal_orders", meal_orders);
app.use("/store_preferences", store_preferences);
app.use("/couriers", couriers);
app.use("/routing_sessions", routing_sessions);
app.use("/courier_trips", courier_trips);