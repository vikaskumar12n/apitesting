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