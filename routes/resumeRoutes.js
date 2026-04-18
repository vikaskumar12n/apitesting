import express from "express";
import {
    saveResume,
    getAllResumes,
    updateResume,
    Enquery
} from "../controller/resumeController.js";
import {generatePDF} from "../controller/pdfgenerate.js"

import { verifyToken } from "../middleware/auth.js";

const route = express.Router();

route.post("/resume/save", saveResume);
route.get("/resume/all", getAllResumes);
route.put("/resume/update", verifyToken, updateResume);
route.get("/resume/pdf", verifyToken, generatePDF);


// Query
route.post("/query",Enquery)

export default route;