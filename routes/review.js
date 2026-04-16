import {createReview,getReviews} from "../controller/review.js"
import express from "express"
const routers = express.Router(); 
routers.post("/review", createReview);
routers.get("/reviews", getReviews);
 
export default routers;