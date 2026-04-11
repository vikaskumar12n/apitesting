import { readJsonFromS3, writeJsonToS3 } from "../utils/s3Helper.js";

export const saveResume = async (req, res) => {
    try {
        // const userId = req.user.id;
        const resumeData = req.body;

        const key = `resumes/${Date.now()}.json`;

        await writeJsonToS3(key, resumeData);

        res.json({
            message: "Resume saved successfully ✅"
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error saving resume" });
    }
};

export const getResume = async (req, res) => {
    try {
        const userId = req.user.id;

        const key = `resumes/${userId}.json`;

        const data = await readJsonFromS3(key);

        res.json({ data });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error fetching resume" });
    }
};


export const updateResume = async (req, res) => {
    try {
        const userId = req.user.id;
        const updatedData = req.body;

        const key = `resumes/${userId}.json`;

        await writeJsonToS3(key, updatedData);

        res.json({
            message: "Resume updated successfully ✅"
        });

    } catch (err) {
        console.log(err);   
        res.status(500).json({ message: "Error updating resume" });
    }
};