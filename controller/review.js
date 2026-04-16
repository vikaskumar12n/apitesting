
import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { readJsonFromS3, writeJsonToS3 } from "../utils/s3Helper.js";
 
import dotenv from "dotenv"
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
    },
});
export const createReview = async (req, res) => {
  try {
    const { fullname, email,rating, review, description } = req.body;
 
    if (!fullname ||!rating|| !review) {
      return res.status(400).json({
        success: false,
        message: "Fullname and review are required"
      });
    }
 
    let reviews = await readJsonFromS3("review");
 
    if (!Array.isArray(reviews)) {
      reviews = [];
    }
 
    const newReview = {
      id: Date.now().toString(),
      fullname: fullname.trim(),
      email: email.toLowerCase().trim(),
      rating: rating.trim(),
      review: review.trim(),
      description: description?.trim() || null,
      createdAt: new Date().toISOString()
    };
 
    reviews.push(newReview); 
    await writeJsonToS3("review", reviews);

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data: newReview
    });

  } catch (err) {
    console.log("Create Review Error:", err);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

export const getReviews = async (req, res) => {
  try { 
    let reviews = await readJsonFromS3("review");
 
    if (!Array.isArray(reviews)) {
      reviews = [];
    }
 
    reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({
      success: true,
      total: reviews.length,
      data: reviews
    });

  } catch (err) {
    console.log("Get Reviews Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch reviews"
    });
  }
};