import puppeteer from "puppeteer";
import { readJsonFromS3 } from "../utils/s3Helper.js";

export const generatePDF = async (req, res) => {
    try {
        const userId = req.user.id;
        const key = `resumes/${userId}.json`;
        const resume = await readJsonFromS3(key);

        const html = `
        <html>
        <head>
            <style>
                body {
                    margin: 0;
                    font-family: Arial, sans-serif;
                }

                .container {
                    display: flex;
                    width: 100%;
                }

                .left {
                    width: 30%;
                    background: #1f2937;
                    color: white;
                    padding: 20px;
                }

                .right {
                    width: 70%;
                    padding: 20px;
                }

                h1 {
                    font-size: 22px;
                    margin-bottom: 10px;
                }

                h2 {
                    font-size: 16px;
                    margin-top: 20px;
                    border-bottom: 1px solid #ccc;
                    padding-bottom: 5px;
                }

                p {
                    font-size: 12px;
                    margin: 4px 0;
                }

                ul {
                    padding-left: 15px;
                }

                li {
                    font-size: 12px;
                    margin-bottom: 5px;
                }

                .section {
                    margin-bottom: 10px;
                }

                .small {
                    font-size: 11px;
                    opacity: 0.8;
                }
            </style>
        </head>

        <body>
            <div class="container">

                <!-- LEFT SIDE -->
                <div class="left">
                    <h1>${resume.personalInfo?.name || ""}</h1>

                    <p>${resume.personalInfo?.phone || ""}</p>
                    <p>${resume.personalInfo?.email || ""}</p>
                    <p>${resume.personalInfo?.location || ""}</p>

                    <h2>SKILLS</h2>
                <p>
                ${Object.values(resume.skills || {})
                .flat()
                .map(skill => `<li>${skill}</li>`)
                .join("")}
                </p>
                </div>

                <!-- RIGHT SIDE -->
                <div class="right">

                    <div class="section">
                        <h2>OBJECTIVE</h2>
                        <p>${resume.objective || ""}</p>
                    </div>

                    <div class="section">
                        <h2>EDUCATION</h2>
                        ${(resume.education || []).map(e => `
                            <p><b>${e.degree}</b></p>
                            <p class="small">${e.college}</p>
                            <p class="small">${e.year}</p>
                        `).join("")}
                    </div>

                    <div class="section">
                        <h2>EXPERIENCE</h2>
                        ${(resume.experience || []).map(exp => `
                            <p><b>${exp.role}</b></p>
                            <p class="small">${exp.company}</p>
                            <p class="small">${exp.duration}</p>
                            <p>${exp.description || ""}</p>
                        `).join("")}
                    </div>

                    <div class="section">
                        <h2>PROJECTS</h2>
                        ${(resume.projects || []).map(p => `
                            <p><b>${p.title}</b></p>
                            <p>${p.description}</p>
                        `).join("")}
                    </div>

                    <div class="section">
                        <h2>CERTIFICATIONS</h2>
                        <ul>
                    ${(resume.certifications || [])
                .map(c => `<li>${c.title}</li>
                      <li>${c.organization}</li>
                      <li>${c.year}</li>`)
                .join("")}
                    </ul>
                    </div>

                </div>

            </div>
        </body>
        </html>
        `;

        const browser = await puppeteer.launch({
            args: ["--no-sandbox"]
        });

        const page = await browser.newPage();
        await page.setContent(html);

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "10px",
                bottom: "10px",
                left: "10px",
                right: "10px"
            }
        });

        await browser.close();

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": "attachment; filename=resume.pdf"
        });

        res.send(pdf);

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "PDF generation error" });
    }
};