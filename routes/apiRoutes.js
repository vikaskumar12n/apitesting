import express from "express";
import { startSaving, getData ,registerUser,loginUser,searchData,updateUser,deleteUser} from "../controller/apiController.js";
 
const router = express.Router();
//register and login
router.post("/register", registerUser);
router.post("/login", loginUser);
router.put("/update-user/:id", updateUser);
router.delete("/delete-user/:id", deleteUser);

router.post("/save", startSaving);
router.get("/data/:collection", getData);
router.get("/search/:collection", searchData);
 
export default router;