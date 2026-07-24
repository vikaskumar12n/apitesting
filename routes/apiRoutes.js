import express from "express";
import { optionalAuth, verifyToken, requireAdmin, requireUser, requireCollege } from "../middleware/auth.js";
import { startSaving, getData,updateAdmin,
    contactUs,getUsers,
    getContacts, subscription,getsubscribers,registerUser,loginUser,searchData,updateUser,deleteUser,applyToCollege,getMyApplications,getAllApplications,assignApplicationToCollege,getCollegeAssignedApplications} from "../controller/apiController.js";
 
const router = express.Router();
//User register and login
router.post("/register", optionalAuth, registerUser);
router.post("/login", loginUser);
router.get("/users", verifyToken, requireAdmin, getUsers);
router.put("/update-user/:id", verifyToken, updateUser);
router.delete("/delete-user/:id", verifyToken, requireAdmin, deleteUser);
router.post("/applications", verifyToken, requireUser, applyToCollege);
router.get("/applications/me", verifyToken, requireUser, getMyApplications);
router.get("/applications", verifyToken, requireAdmin, getAllApplications);
router.put("/applications/:id/assign", verifyToken, requireAdmin, assignApplicationToCollege);
router.get("/college/applications", verifyToken, requireCollege, getCollegeAssignedApplications);


//user subscription and data handling
router.post("/subscribe", subscription);
router.get("/subscribers", getsubscribers);
//admin routes
router.put("/admin/update/:id", verifyToken, requireAdmin, updateAdmin);
//contact us routes
router.post("/contact", contactUs);
router.get("/contacts", getContacts);
// data handling routes
router.post("/save", startSaving);
router.get("/data/:collection", getData);
router.get("/search/:collection", searchData);
 
export default router;