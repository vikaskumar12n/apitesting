import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { readJsonFromS3, writeJsonToS3 } from "../utils/s3Helper.js";
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()
let progress = {
    totalInserted: 0,
    status: "idle"
};

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
    },
});
 
const streamToString = async (stream) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", (err) => reject(err));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        stream.on("close", () => resolve(Buffer.concat(chunks).toString("utf-8"))); //   fix
    });
}; 
const saveLargeData = async (url) => {
    try {
        progress.status = "running";

        const response = await axios.get(url);
        const apiData = response.data;

        let finalData = [];

        //  Case 1: API already array hai
        if (Array.isArray(apiData)) {
            finalData = apiData.map((item, index) => ({
                ...item,
                _order: index
            }));
        }
        //   Case 2: API me data array ke andar hai
        else if (apiData.data && Array.isArray(apiData.data)) {
            finalData = apiData.data.map((item, index) => ({
                ...item,
                _order: index
            }));
        }
        //   Case 3: Object hai (tumhara case )
        else {
            const entries = Object.entries(apiData);

            finalData = entries.map(([key, value], index) => ({
                category: key,      //  important (future use)
                ...value,
                _order: index
            }));
        }

        const collectionName = new URL(url)
            .pathname
            .split("/")
            .filter(Boolean)
            .pop();

        console.log("Collection:", collectionName);
        console.log("FINAL LENGTH:", finalData.length);

        await s3.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: collectionName,
            Body: JSON.stringify(finalData, null, 2),
            ContentType: "application/json",
        }));

        progress.totalInserted = finalData.length;
        progress.status = "completed";

        console.log("Data uploaded to S3 ");

    } catch (err) {
        progress.status = "error";
        console.log("Error:", err.message);
    }
};
export const registerUser = async (req, res) => {
    try {
        const { fullname, email, password, confirmPassword } = req.body;

        //  validation
        if (!fullname || !email || !password || !confirmPassword) {
            return res.status(400).json({ message: "All fields required " });
        }

        //  password match check
        if (password !== confirmPassword) {
            return res.status(400).json({ message: "Passwords do not match " });
        }

        //  S3 se users read
        let users = await readJsonFromS3("users");

        //  check existing
        const exist = users.find(u => u.email === email);
        if (exist) {
            return res.status(400).json({ message: "User already exists " });
        }

        // 🔐 hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = {
            id: Date.now().toString(),
            fullname,
            email,
            password: hashedPassword
        };

        users.push(newUser);

        //  S3 me save
        await writeJsonToS3("users", users);

        res.json({
            message: "User registered successfully ",
            user: newUser
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};
export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email & password required " });
        }
        let users = await readJsonFromS3("users");

        const user = users.find(u => u.email === email);

        if (!user) {
            return res.status(400).json({ message: "User not found " });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: "Invalid password " });
        }
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email
            },
            process.env.SECRET_KEY || "jWttoken",
            {
                expiresIn: "7d"
            }
        );

        res.json({
            message: "Login successful  ",
            token,
            user: {
                id: user.id,
                fullname: user.fullname,
                email: user.email
            }
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};
export const startSaving = async (req, res) => {
    console.log(" POST /api/save hit");
    console.log("Request body:", req.body);

    const { url } = req.body;
    if (!url) return res.status(400).json({ message: "URL required" });

    progress = { totalInserted: 0, status: "running" };

    saveLargeData(url);

    res.json({
        success: true,
        message: "Data saving started"
    });
};
export const getData = async (req, res) => {
    
    const { collection } = req.params;

    if (!collection) {
        return res.status(400).json({ message: "Collection name required" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const key = collection.trim();

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
        });

        const data = await s3.send(command);

        if (!data.Body) {
            return res.json({ data: [] });
        }

        const bodyContents = await streamToString(data.Body);
        let jsonData = JSON.parse(bodyContents);

        let finalData = [];

        //  Case 1: already array
        if (Array.isArray(jsonData)) {
            finalData = jsonData;
        }
        //  Case 2: nested array
        else if (jsonData.data && Array.isArray(jsonData.data)) {
            finalData = jsonData.data;
        }
        //  Case 3: object → convert to array
        else {
            finalData = Object.entries(jsonData).map(([key, value], index) => ({
                category: key,
                ...value,
                _order: index
            }));
        }

        //  sort by order
        const sortedData = finalData.sort((a, b) => {
            return (a._order || 0) - (b._order || 0);
        });

        //  pagination
        const paginatedData = sortedData.slice(skip, skip + limit);

        res.json({
            data: paginatedData
        });

    } catch (err) {
        console.log("S3 fetch error:", err.message);

        res.status(500).json({
            error: err.message
        });
    }
};

export const searchData = async (req, res) => {
    try {
        const { collection } = req.params;

        const search = (req.query.search || "").toLowerCase().trim();

        //  PARSE FILTERS (filters[field]=value)
        let filters = {};
        Object.keys(req.query).forEach(key => {
            if (key.startsWith("filters[")) {
                const field = key.match(/filters\[(.*)\]/)[1];
                filters[field] = req.query[key];
            }
        });

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: collection.trim(),
        });

        const data = await s3.send(command);

        if (!data?.Body) {
            return res.json({ success: true, total: 0, data: [] });
        }

        const bodyContents = await streamToString(data.Body);
        const jsonData = JSON.parse(bodyContents);

        //  EXTRACT ALL COLLEGES (UNIVERSAL)
        let allColleges = [];

        const extractColleges = (data) => {
            if (!data) return;

            if (Array.isArray(data)) {
                data.forEach(item => extractColleges(item));
            } else if (typeof data === "object") {

                if (Array.isArray(data.colleges)) {
                    allColleges.push(...data.colleges);
                }

                if (data.college_details) {
                    allColleges.push(data.college_details);
                }

                if (data.id && (data.name || data.college_info)) {
                    allColleges.push(data);
                }

                Object.values(data).forEach(val =>
                    extractColleges(val)
                );
            }
        };

        extractColleges(jsonData);

        console.log("TOTAL COLLEGES:", allColleges.length);

        if (allColleges.length === 0) {
            return res.json({
                success: true,
                message: "No colleges extracted",
                data: []
            });
        }

        //  DEEP SEARCH
        const deepSearch = (obj, text) => {
            if (!obj) return false;

            if (typeof obj !== "object") {
                return String(obj).toLowerCase().includes(text);
            }

            if (Array.isArray(obj)) {
                return obj.some(v => deepSearch(v, text));
            }

            return Object.values(obj).some(v =>
                deepSearch(v, text)
            );
        };

        //  UNIVERSAL FILTER (ANY FIELD)
        const matchFieldAnywhere = (obj, field, value) => {
            if (!obj) return false;

            if (typeof obj !== "object") return false;

            for (let key in obj) {
                const val = obj[key];

                // match key + value
                if (
                    key.toLowerCase() === field.toLowerCase() &&
                    String(val).toLowerCase().includes(value)
                ) {
                    return true;
                }

                // recursion
                if (typeof val === "object") {
                    if (matchFieldAnywhere(val, field, value)) {
                        return true;
                    }
                }
            }

            return false;
        };

        let result = allColleges;

        // 🔍 APPLY SEARCH
        if (search) {
            result = result.filter(item =>
                deepSearch(item, search)
            );
        }

        console.log("AFTER SEARCH:", result.length);

        // 🎯 APPLY FILTERS (ANY FIELD)
        Object.keys(filters).forEach(field => {
            const value = String(filters[field]).toLowerCase().trim();

            result = result.filter(item =>
                matchFieldAnywhere(item, field, value)
            );
        });
 

        //  REMOVE DUPLICATES (IMPORTANT)
        result = Array.from(
            new Map(result.map(item => [item.id, item])).values()
        );

        return res.json({
            success: true,
            data: result
        });

    } catch (err) {
        console.log("SEARCH ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};