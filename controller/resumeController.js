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

    const id= Date.now().toString();
    const newReview = {
      id,
      fullname: fullname.trim(),
      email: email ? email.toLowerCase().trim() : null,
      subject: subject ? subject.trim() : null,
      message: message.trim(),
      createdAt: new Date().toISOString(),
    };

    // 👉 unique file name
    const fileName = `enquiry/${Date.now()}.json`;

    // 👉 save single object
    await writeJsonToS3(fileName, newReview);

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
export const getEnquiryById = async (req, res) => {
 
  const { id } = req.params;

  try {
    const fileName = `enquiry/${id}.json`; 
    const data = await readJsonFromS3(fileName);
  
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });

  } catch (err) {
    console.log("GET Error:", err);

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