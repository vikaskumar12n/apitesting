import express from "express"
 
import cors from "cors"
 import resumeRoutes from "./routes/resumeRoutes.js"
import apiRouter from "./routes/apiRoutes.js"
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
 
dotenv.config({ path: path.join(__dirname, ".env") }); 
const app=express()
 
app.use(cors())
app.use(express.json())
app.use("/api",resumeRoutes)
app.use("/api",apiRouter)
app.listen(process.env.PORT,()=>{
    console.log(`server is running port ${process.env.PORT}`);
    
})
