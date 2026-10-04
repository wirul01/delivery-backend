import express from "express";
import { router as index } from "./controller/index";
import { router as customers } from "./controller/customers";   

export const app = express();

app.use(express.json());

app.use("/", index);
app.use("/customer", customers);
