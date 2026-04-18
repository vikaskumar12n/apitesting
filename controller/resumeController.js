import { readJsonFromS3,listObjects, writeJsonToS3 } from "../utils/s3Helper.js";

export const saveResume = async (req, res) => {
    try { 
        const resumeData = req.body;

        const key = `resumes/${Date.now()}.json`; // 👈 FIX

        await writeJsonToS3(key, resumeData);

        res.json({
            message: "Resume saved successfully ✅",
            resumeData
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error saving resume" });
    }
};

export const Enquery = async (req, res) => {
  const { fullname, email, subject, message } = req.body;

  try {
    // validation
    if (!fullname || !message) {
      return res.status(400).json({
        success: false,
        message: "Fullname and Message fields are required",
      });
    }

    // fetch existing data from S3
    let reviews = await readJsonFromS3("review");

    if (!Array.isArray(reviews)) {
      reviews = [];
    }

    const newReview = {
      id: Date.now().toString(),
      fullname: fullname.trim(),
      email: email ? email.toLowerCase().trim() : null,
      subject: subject ? subject.trim() : null,
      message: message.trim(),
      createdAt: new Date().toISOString(),
    };

    reviews.push(newReview);

    await writeJsonToS3("review", reviews);

    return res.status(201).json({
      success: true,
      message: "Query submitted successfully",
      data: newReview,
    });

  } catch (err) {
    console.log("Enquery Error:", err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const getAllResumes = async (req, res) => {
    try {
        const prefix = "resumes/";

        // 1️⃣ Get all files
        const files = await listObjects(prefix);

        // 2️⃣ Read all files
        const allData = [];

        for (let file of files) {   
            const data = await readJsonFromS3(file.Key);
            allData.push(data);
        }

        res.json({ data: allData });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error fetching resumes" });
    }
};


export const updateResume = async (req, res) => {
    try {
        const userId = req.user.id;
        const updatedData = req.body;

        const key = `resumes/${userId}.json`;

        await writeJsonToS3(key, updatedData);

        res.json({
            message: "Resume updated successfully "
        });

    } catch (err) {
        console.log(err);   
        res.status(500).json({ message: "Error updating resume" });
    }
};