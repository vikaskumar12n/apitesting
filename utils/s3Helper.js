import { S3Client, GetObjectCommand,ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv"
dotenv.config()
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
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
};


export const listObjects = async (prefix) => {
  const command = new ListObjectsV2Command({
    Bucket: process.env.AWS_BUCKET_NAME,
    Prefix: prefix
  });

  const response = await s3.send(command);

  return response.Contents || [];  
};
 
export const readJsonFromS3 = async (key) => {
    try {
        const data = await s3.send(new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
        })); 
        if (!data.Body) return []; 
        const body = await streamToString(data.Body);
        return JSON.parse(body); 
    } catch (err) {
        if (err.name === "NoSuchKey") return []; // first time file
        throw err;
    }
};
 
export const writeJsonToS3 = async (key, data) => {
    await s3.send(new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
    }));
};


 

 