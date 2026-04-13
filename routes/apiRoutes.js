import express from "express";
import { startSaving, getData ,registerUser,loginUser,searchData} from "../controller/apiController.js";
 
const router = express.Router();
//register and login
router.post("/register", registerUser);
router.post("/login", loginUser);

router.post("/save", startSaving);
router.get("/data/:collection", getData);
router.get("/search/:collection", searchData);
 
export default router;