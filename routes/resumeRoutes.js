import express from "express";
import {
    saveResume,
    getAllResumes,
    updateResume
} from "../controller/resumeController.js";
import {generatePDF} from "../controller/pdfgenerate.js"

import { verifyToken } from "../middleware/auth.js";

const route = express.Router();

route.post("/resume/save", saveResume);
route.get("/resume/all", getAllResumes);
route.put("/resume/update", verifyToken, updateResume);
route.get("/resume/pdf", verifyToken, generatePDF);

export default route;