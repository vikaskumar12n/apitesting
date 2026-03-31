import express from "express";
import { startSaving, getData } from "../controller/apiController.js";

const router = express.Router();

router.post("/save", startSaving);
router.get("/data/:collection", getData);

export default router;