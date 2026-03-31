import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
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
        stream.on("close", () => resolve(Buffer.concat(chunks).toString("utf-8"))); // 🔥 fix
    });
};

// console.log("AWS Key:", key);
// console.log("AWS Secret:", key1);

const saveLargeData = async (url) => {
    try {
        progress.status = "running";

        const response = await axios.get(url);
        const apiData = response.data;

        const dataArray = Array.isArray(apiData)
            ? apiData
            : apiData.data || [];
        const collectionName = new URL(url)
            .pathname
            .split("/")
            .filter(Boolean)
            .pop();

        console.log("Collection:", collectionName);

        const dataWithOrder = dataArray.map((item, index) => ({
            ...item,
            _order: index
        }));

        await s3.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: collectionName,
            Body: JSON.stringify(dataWithOrder),
            ContentType: "application/json",
        }));

        progress.totalInserted = dataWithOrder.length;
        progress.status = "completed";

        console.log("Data uploaded to S3 ✅");

    } catch (err) {
        progress.status = "error";
        console.log("Error:", err.message);
    }
};
export const startSaving = async (req, res) => {
    console.log("✅ POST /api/save hit");
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
        if (!Array.isArray(jsonData)) {
            jsonData = jsonData.data || [];
        }

        if (!Array.isArray(jsonData)) {
            return res.json({ data: [] });
        }
        const sortedData = jsonData.sort((a, b) => {
            return (a._order || 0) - (b._order || 0);
        });

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