import express from "express";
import { router as index } from "./controller/index";
import { router as buyers } from "./controller/buyers";   
import { router as meal_orders } from "./controller/meal_orders"; // เพิ่มการนำเข้า router ของ orders
import cors from 'cors';

export const app = express();


app.use(cors());
app.use(express.json());

app.use("/", index);
app.use("/buyers", buyers); 
app.use("/meal_orders", meal_orders); 
