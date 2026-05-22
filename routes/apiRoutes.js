import express from "express";
import { startSaving, getData,registerAdmin,loginAdmin,updateAdmin,
    contactUs,
    getContacts, subscription,getsubscribers,registerUser,loginUser,searchData,updateUser,deleteUser} from "../controller/apiController.js";
 
const router = express.Router();
//User register and login
router.post("/register", registerUser);
router.post("/login", loginUser);
router.put("/update-user/:id", updateUser);
router.delete("/delete-user/:id", deleteUser);
//user subscription and data handling
router.post("/subscribe", subscription);
router.get("/subscribers", getsubscribers);
//admin routes
router.post("/admin/register", registerAdmin);
router.post("/admin/login", loginAdmin);
router.put("/admin/update/:id", updateAdmin);
//contact us routes
router.post("/contact", contactUs);
router.get("/contacts", getContacts);
// data handling routes
router.post("/save", startSaving);
router.get("/data/:collection", getData);
router.get("/search/:collection", searchData);
 
export default router;