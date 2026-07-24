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

// User Auth Controller
const USER_ROLES = new Set(["user", "college"]);

const normalizeUserRole = (role) => {
    const normalizedRole = String(role || "").trim().toLowerCase();
    return USER_ROLES.has(normalizedRole) ? normalizedRole : null;
};

const toSafeUser = (user) => ({
    id: user.id,
    fullname: user.fullname,
    email: user.email,
    mobile: user.mobile,
    address: user.address,
    role: normalizeUserRole(user.role) || "user"
});

const createUserToken = (user) => jwt.sign(
    {
        id: user.id,
        email: user.email,
        role: normalizeUserRole(user.role) || "user"
    },
    process.env.SECRET_KEY || "jWttoken",
    { expiresIn: "7d" }
);

const ACCOUNT_ROLES = new Set(["user", "college", "admin"]);

const normalizeAccountRole = (role) => {
    const normalizedRole = String(role || "").trim().toLowerCase();
    return ACCOUNT_ROLES.has(normalizedRole) ? normalizedRole : null;
};

const toSafeAdmin = (admin) => ({
    id: admin.id,
    fullname: admin.fullname,
    email: admin.email,
    mobile: admin.mobile || "",
    address: admin.address || "",
    role: "admin"
});

export const registerUser = async (req, res) => {
    try {
        const {
            fullname,
            email,
            password,
            confirmPassword,
            mobile,
            address,
            role
        } = req.body;

        const requestedRole = role === undefined
            ? "user"
            : normalizeAccountRole(role);

        if (!requestedRole) {
            return res.status(400).json({
                message: "Role must be user, college, or admin"
            });
        }

        const requiresContactDetails = requestedRole !== "admin";

        if (
            !fullname?.trim() ||
            !email?.trim() ||
            !password ||
            !confirmPassword ||
            (requiresContactDetails && (!mobile?.trim() || !address?.trim()))
        ) {
            return res.status(400).json({
                message: requiresContactDetails
                    ? "All fields are required"
                    : "Full name, email, password, and confirm password are required"
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                message: "Passwords do not match"
            });
        }

        let [users, admins] = await Promise.all([
            readJsonFromS3("users"),
            readJsonFromS3("admins")
        ]);

        if (!Array.isArray(users)) {
            users = [];
        }
        if (!Array.isArray(admins)) {
            admins = [];
        }

        const requesterIsAdmin =
            req.user?.role === "admin" || req.user?.isAdmin === true;
        const isFirstAdmin = requestedRole === "admin" && admins.length === 0;

        if (requestedRole !== "user" && !requesterIsAdmin && !isFirstAdmin) {
            return res.status(403).json({
                message: "Only an admin can register college or admin accounts"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const emailExists =
            users.some(account => account.email?.toLowerCase() === normalizedEmail) ||
            admins.some(account => account.email?.toLowerCase() === normalizedEmail);

        if (emailExists) {
            return res.status(400).json({
                message: "Account already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        let safeAccount;

        if (requestedRole === "admin") {
            const newAdmin = {
                id: Date.now().toString(),
                fullname: fullname.trim(),
                email: normalizedEmail,
                password: hashedPassword,
                role: "admin",
                mobile: mobile?.trim() || "",
                address: address?.trim() || ""
            };

            admins.push(newAdmin);
            await writeJsonToS3("admins", admins);
            safeAccount = toSafeAdmin(newAdmin);
        } else {
            const newUser = {
                id: Date.now().toString(),
                fullname: fullname.trim(),
                email: normalizedEmail,
                mobile: mobile.trim(),
                address: address.trim(),
                password: hashedPassword,
                role: requestedRole
            };

            users.push(newUser);
            await writeJsonToS3("users", users);
            safeAccount = toSafeUser(newUser);
        }

        const successMessages = {
            user: "User registered successfully",
            college: "College account created successfully",
            admin: "Admin registered successfully"
        };

        return res.status(201).json({
            message: successMessages[requestedRole],
            role: requestedRole,
            user: safeAccount
        });
    } catch (err) {
        console.error("Register account error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};
export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email?.trim() || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        let [users, admins] = await Promise.all([
            readJsonFromS3("users"),
            readJsonFromS3("admins")
        ]);

        if (!Array.isArray(users)) {
            users = [];
        }
        if (!Array.isArray(admins)) {
            admins = [];
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = users.find(
            storedUser => storedUser.email?.toLowerCase() === normalizedEmail
        );
        const admin = admins.find(
            storedAdmin => storedAdmin.email?.toLowerCase() === normalizedEmail
        );

        if (!user && !admin) {
            return res.status(404).json({
                message: "Account not found"
            });
        }

        if (admin && await bcrypt.compare(password, admin.password)) {
            const safeAdmin = {
                id: admin.id,
                fullname: admin.fullname,
                email: admin.email,
                role: "admin"
            };
            const token = jwt.sign(
                {
                    id: safeAdmin.id,
                    email: safeAdmin.email,
                    role: "admin",
                    isAdmin: true
                },
                process.env.SECRET_KEY || "jWttoken",
                { expiresIn: "7d" }
            );

            return res.status(200).json({
                message: "Login successful",
                token,
                role: "admin",
                user: safeAdmin
            });
        }

        if (user && await bcrypt.compare(password, user.password)) {
            const safeUser = toSafeUser(user);
            const token = createUserToken(safeUser);

            return res.status(200).json({
                message: "Login successful",
                token,
                role: safeUser.role,
                user: safeUser
            });
        }

        return res.status(400).json({
            message: "Invalid password"
        });
    } catch (err) {
        console.error("Login error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};
export const getUsers = async (req, res) => {
    try {
        let users = await readJsonFromS3("users");

        if (!Array.isArray(users)) {
            users = [];
        }

        const safeUsers = users.map(user => ({
            id: user.id,
            fullname: user.fullname,
            email: user.email,
            mobile: user.mobile,
            address: user.address,
            role: normalizeUserRole(user.role) || "user"
        }));

        return res.status(200).json({
            message: "Users fetched successfully",
            count: safeUsers.length,
            users: safeUsers
        });

    } catch (err) {
        console.error("Get users error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};
export const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user?.role === "admin" || req.user?.isAdmin === true;
        const isOwnAccount = String(req.user?.id) === String(id);

        if (!isAdmin && !isOwnAccount) {
            return res.status(403).json({
                message: "You cannot update this account"
            });
        }

        const {
            fullname,
            email,
            password,
            mobile,
            address,
            role
        } = req.body;

        let users = await readJsonFromS3("users");

        if (!Array.isArray(users)) {
            users = [];
        }

        const userIndex = users.findIndex(
            user => String(user.id) === String(id)
        );

        if (userIndex === -1) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        if (email) {
            const normalizedEmail = email.trim().toLowerCase();

            const emailExists = users.some(
                (user, index) =>
                    index !== userIndex &&
                    user.email?.toLowerCase() === normalizedEmail
            );

            if (emailExists) {
                return res.status(400).json({
                    message: "Email already exists"
                });
            }

            users[userIndex].email = normalizedEmail;
        }

        if (fullname?.trim()) {
            users[userIndex].fullname = fullname.trim();
        }

        if (mobile?.trim()) {
            users[userIndex].mobile = mobile.trim();
        }

        if (address?.trim()) {
            users[userIndex].address = address.trim();
        }

        if (role?.trim()) {
            if (!isAdmin) {
                return res.status(403).json({
                    message: "Only an admin can change a user role"
                });
            }

            const normalizedRole = normalizeUserRole(role);

            if (!normalizedRole) {
                return res.status(400).json({
                    message: "Role must be user or college"
                });
            }

            users[userIndex].role = normalizedRole;
        }

        if (password) {
            users[userIndex].password = await bcrypt.hash(password, 10);
        }

        // Purane user ke andar role na ho to default role
        if (!users[userIndex].role) {
            users[userIndex].role = "user";
        }

        await writeJsonToS3("users", users);

        return res.status(200).json({
            message: "User updated successfully",
            user: {
                id: users[userIndex].id,
                fullname: users[userIndex].fullname,
                email: users[userIndex].email,
                mobile: users[userIndex].mobile,
                address: users[userIndex].address,
                role: users[userIndex].role
            }
        });

    } catch (err) {
        console.error("Update user error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};
export const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        let users = await readJsonFromS3("users");

        if (!Array.isArray(users)) {
            users = [];
        }

        const userExists = users.some(
            user => String(user.id) === String(id)
        );

        if (!userExists) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const updatedUsers = users.filter(
            user => String(user.id) !== String(id)
        );

        await writeJsonToS3("users", updatedUsers);

        return res.status(200).json({
            message: "User deleted successfully"
        });

    } catch (err) {
        console.error("Delete user error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};








// User college applications
const toApplicationText = (value, maxLength = 300) =>
    String(value || "").trim().slice(0, maxLength);

const toSafeApplication = (application) => ({
    id: application.id,
    collegeId: application.collegeId,
    collegeName: application.collegeName,
    stream: application.stream,
    location: application.location,
    image: application.image,
    detailsPath: application.detailsPath,
    status: application.status,
    appliedAt: application.appliedAt,
    assignedCollegeId: application.assignedCollegeId || null,
    assignedCollegeName: application.assignedCollegeName || null,
    assignedAt: application.assignedAt || null
});

const toSafeApplicant = (user) => user ? ({
    id: user.id,
    fullname: user.fullname,
    email: user.email,
    mobile: user.mobile,
    address: user.address,
    role: "user"
}) : null;

const withApplicationRelations = (application, users) => {
    const applicant = users.find(user =>
        String(user.id) === String(application.userId) &&
        (normalizeUserRole(user.role) || "user") === "user"
    );
    const assignedCollege = users.find(user =>
        String(user.id) === String(application.assignedCollegeId) &&
        normalizeUserRole(user.role) === "college"
    );

    return {
        ...toSafeApplication(application),
        applicant: toSafeApplicant(applicant),
        assignedCollege: assignedCollege ? toSafeUser(assignedCollege) : null
    };
};

export const applyToCollege = async (req, res) => {
    try {
        const collegeId = toApplicationText(req.body.collegeId, 100);
        const collegeName = toApplicationText(req.body.collegeName, 200);
        const stream = toApplicationText(req.body.stream, 80).toLowerCase();
        const location = toApplicationText(req.body.location, 200);
        const image = toApplicationText(req.body.image, 1000);
        const requestedDetailsPath = toApplicationText(req.body.detailsPath, 500);

        if (!collegeId || !collegeName || !stream) {
            return res.status(400).json({
                message: "College ID, college name, and stream are required"
            });
        }

        let applications = await readJsonFromS3("applications");

        if (!Array.isArray(applications)) {
            applications = [];
        }

        const userId = String(req.user.id);
        const applicationKey = `${stream}:${collegeId}`;
        const existingApplication = applications.find(application =>
            String(application.userId) === userId &&
            (application.applicationKey === applicationKey ||
                (String(application.collegeId) === collegeId && application.stream === stream))
        );

        if (existingApplication) {
            return res.status(200).json({
                message: "You have already applied to this college",
                alreadyApplied: true,
                application: toSafeApplication(existingApplication)
            });
        }

        const detailsPath = requestedDetailsPath.startsWith("/college/")
            ? requestedDetailsPath
            : `/college/${stream}/${collegeId}`;
        const newApplication = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userId,
            applicationKey,
            collegeId,
            collegeName,
            stream,
            location,
            image,
            detailsPath,
            status: "applied",
            appliedAt: new Date().toISOString()
        };

        applications.push(newApplication);
        await writeJsonToS3("applications", applications);

        return res.status(201).json({
            message: "College application added successfully",
            alreadyApplied: false,
            application: toSafeApplication(newApplication)
        });
    } catch (err) {
        console.error("Apply to college error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};

export const getMyApplications = async (req, res) => {
    try {
        let applications = await readJsonFromS3("applications");

        if (!Array.isArray(applications)) {
            applications = [];
        }

        const userId = String(req.user.id);
        const userApplications = applications
            .filter(application => String(application.userId) === userId)
            .sort((first, second) =>
                new Date(second.appliedAt || 0) - new Date(first.appliedAt || 0)
            )
            .map(toSafeApplication);

        return res.status(200).json({
            message: "Applications fetched successfully",
            count: userApplications.length,
            applications: userApplications
        });
    } catch (err) {
        console.error("Get applications error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};
export const getAllApplications = async (req, res) => {
    try {
        let [applications, users] = await Promise.all([
            readJsonFromS3("applications"),
            readJsonFromS3("users")
        ]);

        if (!Array.isArray(applications)) applications = [];
        if (!Array.isArray(users)) users = [];

        const detailedApplications = applications
            .sort((first, second) =>
                new Date(second.appliedAt || 0) - new Date(first.appliedAt || 0)
            )
            .map(application => withApplicationRelations(application, users));
        const colleges = users
            .filter(user => normalizeUserRole(user.role) === "college")
            .map(toSafeUser);

        return res.status(200).json({
            message: "Applications fetched successfully",
            count: detailedApplications.length,
            applications: detailedApplications,
            colleges
        });
    } catch (err) {
        console.error("Admin get applications error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};

export const assignApplicationToCollege = async (req, res) => {
    try {
        const applicationId = String(req.params.id || "").trim();
        const collegeId = String(req.body.collegeId || "").trim();

        if (!applicationId || !collegeId) {
            return res.status(400).json({
                message: "Application ID and college account are required"
            });
        }

        let [applications, users] = await Promise.all([
            readJsonFromS3("applications"),
            readJsonFromS3("users")
        ]);

        if (!Array.isArray(applications)) applications = [];
        if (!Array.isArray(users)) users = [];

        const applicationIndex = applications.findIndex(application =>
            String(application.id) === applicationId
        );

        if (applicationIndex === -1) {
            return res.status(404).json({ message: "Application not found" });
        }

        const collegeAccount = users.find(user =>
            String(user.id) === collegeId &&
            normalizeUserRole(user.role) === "college"
        );

        if (!collegeAccount) {
            return res.status(404).json({
                message: "College account not found"
            });
        }

        applications[applicationIndex] = {
            ...applications[applicationIndex],
            assignedCollegeId: String(collegeAccount.id),
            assignedCollegeName: collegeAccount.fullname,
            assignedAt: new Date().toISOString(),
            assignedBy: String(req.user.id),
            status: "assigned"
        };

        await writeJsonToS3("applications", applications);

        return res.status(200).json({
            message: "Student application assigned successfully",
            application: withApplicationRelations(applications[applicationIndex], users)
        });
    } catch (err) {
        console.error("Assign application error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};

export const getCollegeAssignedApplications = async (req, res) => {
    try {
        let [applications, users] = await Promise.all([
            readJsonFromS3("applications"),
            readJsonFromS3("users")
        ]);

        if (!Array.isArray(applications)) applications = [];
        if (!Array.isArray(users)) users = [];

        const collegeId = String(req.user.id);
        const assignedApplications = applications
            .filter(application => String(application.assignedCollegeId) === collegeId)
            .sort((first, second) =>
                new Date(second.assignedAt || 0) - new Date(first.assignedAt || 0)
            )
            .map(application => withApplicationRelations(application, users));

        return res.status(200).json({
            message: "Assigned students fetched successfully",
            count: assignedApplications.length,
            applications: assignedApplications
        });
    } catch (err) {
        console.error("College get assigned applications error:", err);

        return res.status(500).json({
            message: "Server error",
            error: err.message
        });
    }
};
//Admin Auth Controller
export const updateAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { fullname, email, password } = req.body;
        let admins = await readJsonFromS3("admins");
        const adminIndex = admins.findIndex(a => a.id === id);
        if (adminIndex === -1) {
            return res.status(404).json({ message: "Admin not found" });
        }
        if (fullname) admins[adminIndex].fullname = fullname;
        if (email) admins[adminIndex].email = email;
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            admins[adminIndex].password = hashedPassword;
        }
        await writeJsonToS3("admins", admins);
        res.json({
            message: "Admin updated successfully",
            admin: {
                id: admins[adminIndex].id,
                fullname: admins[adminIndex].fullname,
                email: admins[adminIndex].email
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};

//contact us controller
export const contactUs = async (req, res) => {
    try {
        const { fullname, email, message,phone,subject } = req.body;
        if (!fullname || !email || !message || !phone || !subject) {
            return res.status(400).json({ message: "All fields required" });
        }
        let contacts = await readJsonFromS3("contacts");
        const newContact = {
            id: Date.now().toString(),
            fullname,
            email,
            phone,
            subject,
            message
        };
        contacts.push(newContact);
        await writeJsonToS3("contacts", contacts);
        res.json({
            message: "Message received successfully",
            contact: newContact
        });
    }       
        catch (err) {   
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};  
export const getContacts = async (req, res) => {
    try {
        let contacts = await readJsonFromS3("contacts");
        res.json({
            contacts
        });
    }
        catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};

// user Subscription Controller
export const subscription = async (req, res) => {
    try {
        const { email } = req.body; 
        if (!email) {
            return res.status(400).json({ message: "Email required" });
        } 
        let subscribers = await readJsonFromS3("subscribers"); 
        if (subscribers.includes(email)) {
            return res.status(400).json({ message: "Already subscribed" });
        } 
        subscribers.push(email);
        await writeJsonToS3("subscribers", subscribers); 
        res.json({
            message: "Subscribed successfully"
        });  
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};

export const getsubscribers = async (req, res) => {
    try {
        let subscribers = await readJsonFromS3("subscribers");
        res.json({
            subscribers
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });  
    }
};

// save json data controller
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
// get json data cotroller
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

// search and filter  controller
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

        //  APPLY SEARCH
        if (search) {
            result = result.filter(item =>
                deepSearch(item, search)
            );
        }

        
        //  APPLY FILTERS (ANY FIELD)
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