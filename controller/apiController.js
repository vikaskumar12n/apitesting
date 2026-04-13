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
            Key: collectionName ,  
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

    const search = req.query.search || "";
    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;
    delete filters.search;

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

        // Normalize data
        if (Array.isArray(jsonData)) {
            finalData = jsonData;
        } else if (jsonData.data && Array.isArray(jsonData.data)) {
            finalData = jsonData.data;
        } else {
            finalData = Object.entries(jsonData).map(([key, value], index) => ({
                category: key,
                ...value,
                _order: index
            }));
        }

        // 🔥 STEP 1: Flatten all colleges
        let allColleges = [];

        finalData.forEach(item => {
            if (item.colleges && Array.isArray(item.colleges)) {
                allColleges.push(...item.colleges);
            }
        });

        // 🔍 STEP 2: SEARCH
        if (search) {
            const s = search.toLowerCase();
            allColleges = allColleges.filter(college =>
                Object.values(college).some(val =>
                    String(val).toLowerCase().includes(s)
                )
            );
        }

        // 🎯 STEP 3: FILTER
        Object.keys(filters).forEach((field) => {
            const val = String(filters[field]).toLowerCase();

            allColleges = allColleges.filter(college =>
                String(college[field] || "")
                    .toLowerCase()
                    .includes(val)
            );
        });

        // 📄 STEP 4: PAGINATION (🔥 NOW WORKING)
        const total = allColleges.length;
        const skip = (page - 1) * limit;

        const paginatedData = allColleges.slice(skip, skip + limit);

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
//     const collections = [
//         "mbatopcollege",
//         "btechtopcollege",
//         "lawcollege",
//         "allindiafashioncollegedetails1_20",
// "allindiafashioncollegedetails21_40",
// "allindiafashioncollegedetails41_60",
// "allindiafashioncollegedetails61_80",
// "allindiafashioncollegedetails81_100",
// "allindiafashioncollegedetails101_120",
// "allindiafashioncollegedetails121_140",
// "allindiafashioncollegedetails141_160",
// "allindiafashioncollegedetails161_180",
// "allindiafashioncollegedetails181_200",
// "allindiafashioncollegedetails201_220",
// "allindiafashioncollegedetails221_240",
// "allindiafashioncollegedetails241_260",
// "allindiafashioncollegedetails261_280",
// "allindiafashioncollegedetails281_300",
// "allindiafashioncollegedetails301_320",
// "allindiafashioncollegedetails321_340",
// "allindiafashioncollegedetails341_360",
// "allindiafashioncollegedetails361_380",
// "allindiafashioncollegedetails381_400",
// "allindiafashioncollegedetails401_420",
// "allindiafashioncollegedetails421_440",
// "allindiafashioncollegedetails441_460",
// "allindiafashioncollegedetails461_480",
// "allindiafashioncollegedetails481_500",
// "allindiafashioncollegedetails501_520",
// "allindiafashioncollegedetails521_540",
// "allindiafashioncollegedetails541_560",
// "allindiafashioncollegedetails561_580",
// "allindiafashioncollegedetails581_600",
// "allindiafashioncollegedetails601_620",
// "allindiafashioncollegedetails621_640",
// "allindiafashioncollegedetails641_660",
// "allindiafashioncollegedetails661_680",
// "allindiafashioncollegedetails681_700",
// "allindiafashioncollegedetails701_720",
// "allindiafashioncollegedetails721_740",
// "allindiafashioncollegedetails741_760",
// "allindiafashioncollegedetails761_780",
// "allindiafashioncollegedetails781_800",
// "allindiafashioncollegedetails801_820",
// "allindiafashioncollegedetails821_840",
// "allindiafashioncollegedetails841_860",
// "allindiafashioncollegedetails861_880",
// "allindiafashioncollegedetails881_900",
// "allindiafashioncollegedetails901_920",
// "allindiafashioncollegedetails921_940",
// "allindiafashioncollegedetails941_960",
// "allindiafashioncollegedetails961_980",
// "allindiafashioncollegedetails981_1000",
// "allindiafashioncollegedetails1001_1020",
// "allindiafashioncollegedetails1021_1040",
// "allindiafashioncollegedetails1041_1060",
// "allindiafashioncollegedetails1061_1080",
// "allindiafashioncollegedetails1081_1100",
// "allindiafashioncollegedetails1101_1120",
// "allindiafashioncollegedetails1121_1140",
// "allindiafashioncollegedetails1141_1155", 
// "allindiamabacollegedetails1_40",
// "allindiamabacollegedetails41_100",
// "allindiamabacollegedetails101_140",
// "allindiamabacollegedetails141_180",
// "allindiamabacollegedetails181_220",
// "allindiamabacollegedetails221_260",
// "allindiamabacollegedetails261_300",
// "allindiamabacollegedetails301_340",
// "allindiamabacollegedetails341_370",
// "allindiamabacollegedetails371_380",
// "allindiamabacollegedetails381_420", 
// "allindiaengineercollegedetails1281_1300",
// "allindiaengineercollegedetails1301_1320",
// "allindiaengineercollegedetails1321_1340",
// "allindiaengineercollegedetails1341_1360",
// "allindiaengineercollegedetails1361_1380",
// "allindiaengineercollegedetails1381_1400",
// "allindiaengineercollegedetails1401_1420",
// "allindiaengineercollegedetails1421_1440",
// "allindiaengineercollegedetails1441_1460",
// "allindiaengineercollegedetails1461_1480",
// "allindiaengineercollegedetails1481_1500",
// "allindiaengineercollegedetails1501_1520",
// "allindiaengineercollegedetails1521_1540",
// "allindiaengineercollegedetails1541_1560",
// "allindiaengineercollegedetails1561_1580",
// "allindiaengineercollegedetails1581_1600",
// "allindiaengineercollegedetails1601_1620",
// "allindiaengineercollegedetails1621_1640",
// "allindiaengineercollegedetails1641_1680",
// "allindiaengineercollegedetails1661_1680",
// "allindiaengineercollegedetails1681_1700",
// "allindiaengineercollegedetails1701_1720",
// "allindiaengineercollegedetails1721_1740",
// "allindiaengineercollegedetails1741_1760",
// "allindiaengineercollegedetails1761_1780",
// "allindiaengineercollegedetails1781_1800",
// "allindiaengineercollegedetails1801_1820",
// "allindiaengineercollegedetails1821_1840",
// "allindiaengineercollegedetails1841_1860",
// "allindiaengineercollegedetails1861_1880",
// "allindiaengineercollegedetails1881_1900",
// "allindiaengineercollegedetails1901_1920",
// "allindiaengineercollegedetails1921_1940",
// "allindiaengineercollegedetails1941_1960",
// "allindiaengineercollegedetails1961_1980",
// "allindiaengineercollegedetails1981_2000",
// "allindiaengineercollegedetails2001_2020",
// "allindiaengineercollegedetails2021_2040",
// "allindiaengineercollegedetails2041_2060",
// "allindiaengineercollegedetails2061_2080",
// "allindiaengineercollegedetails2081_2100",
// "allindiaengineercollegedetails2101_2120",
// "allindiaengineercollegedetails2121_2140",
// "allindiaengineercollegedetails2141_2160",
// "allindiaengineercollegedetails2161_2180",
// "allindiaengineercollegedetails2181_2200",
// "allindiaengineercollegedetails2201_2220",
// "allindiaengineercollegedetails2221_2240",
// "allindiaengineercollegedetails2241_2260",
// "allindiaengineercollegedetails2261_2273",
// "aeronauticalengineering", "aerospaceengineering", "aiapget", 
//     "aircraftmaintenanceengineering", "alldentalcollegedetails", "allEnexam4", 
//     "allEnexam70_118", "allEnexam118_166", "allfashionexam4", 
//     "allindiaengineergollegedetails1_20", "allindiaengineergollegedetails21_40", 
//     "allindiaengineergollegedetails41_60", "allindiaengineergollegedetails61_80", 
//     "allindiaengineergollegedetails81_100", "allindiaengineergollegedetails101_120", 
//     "allindiaengineergollegedetails121_140", "allindiaengineergollegedetails141_160", 
//     "allindiaengineergollegedetails161_180", "allindiaengineergollegedetails181_200", 
//     "allindiaengineergollegedetails201_220", "allindiaengineergollegedetails221_240", 
//     "allindiaengineergollegedetails241_260", "allindiaengineergollegedetails261_280", 
//     "allindiaengineergollegedetails281_300", "allindiaengineergollegedetails301_320", 
//     "allindiaengineergollegedetails321_340", "allindiaengineergollegedetails341_360", 
//     "allindiaengineergollegedetails361_380", "allindiaengineergollegedetails381_400", 
//     "allindiaengineergollegedetails401_420", "allindiaengineergollegedetails421_440", 
//     "allindiaengineergollegedetails441_460", "allindiaengineergollegedetails461_480", 
//     "allindiaengineergollegedetails481_500", "allindiaengineergollegedetails501_520", 
//     "allindiaengineergollegedetails521_540", "allindiaengineergollegedetails541_560", 
//     "allindiaengineergollegedetails561_580", "allindiaengineergollegedetails581_600", 
//     "allindiaengineergollegedetails601_620", "allindiaengineergollegedetails621_640", 
//     "allindiaengineergollegedetails641_660", "allindiaengineergollegedetails661_680", 
//     "allindiaengineergollegedetails681_710", "allindiaengineergollegedetails711_740", 
//     "allindiaengineergollegedetails741_770", "allindiaengineergollegedetails771_800", 
//     "allindiaengineergollegedetails801_830", "allindiaengineergollegedetails831_850", 
//     "allindiaengineergollegedetails851_860", "allindiaengineergollegedetails861_890", 
//     "allindiaengineergollegedetails891_910", "allindiaengineergollegedetails911_920", 
//     "allindiaengineergollegedetails921_940", "allindiaengineergollegedetails941_960", 
//     "allindiaengineergollegedetails961_980", "allindiaengineergollegedetails981_1000", 
//     "allindiaengineergollegedetails1001_1020", "allindiaengineergollegedetails1021_1040", 
//     "allindiaengineergollegedetails1041_1060", "allindiaengineergollegedetails1061_1080", 
//     "allindiaengineergollegedetails1081_1100", "allindiaengineergollegedetails1101_1120", 
//     "allindiaengineergollegedetails1121_1140", "allindiaengineergollegedetails1141_1161", 
//     "allindiaengineergollegedetails1161_1180", "allindiaengineergollegedetails1181_1200", 
//     "allindiaengineergollegedetails1201_1240", "allindiaengineergollegedetails1221_1240", 
//     "allindiaengineergollegedetails1241_1260", "allindiaengineergollegedetails1261_1280", 
//     "topengineeringcollegedetails161_200", "topengineeringcollegedetails201_240", 
//     "topengineeringcollegedetails241_280", "topengineeringcollegedetails281_297", 
//     "topfaishiondesgincollegedetails1_33", "topfaishiondesgincollegedetails34_56", 
//     "topmbacollegedetails1_40", "topmbacollegedetails41_80", "topmbacollegedetails81_all", 
//     "toydesign", "transportationengineering", "uceed", "uiux", "upcat", 
//     "visualmerchandising", "vlsidesign", "wbjee", "webdesign", "wudaptitudetext", "xat",
 
//     "pharmancycollegedetails1_40", "pharmancycollegedetails41_80", "pharmancycollegedetails81_125", 
//     "phd", "physiotherapy", "powerengineering", "productdesign", "productionengineering", 
//     "productmanagement", "publichealthmanagement", "pulppapertechnology", "rfmicrowaveengineering", 
//     "roboticsengineering", "snap", "structuralengineering", "telecommunicationengineering", 
//     "textiledesign", "textileengineering", "toolengineering", "topengineeringcollegedetails1_40", 
//     "topengineeringcollegedetails41_80", "topengineeringcollegedetails81_120", 
//     "topengineeringcollegedetails121_160", "topengineeringcollegedetails161_200",
 
//     "mechatronicsengineering", "medicine", "memtech", "metallurgicalengineering", 
//     "microelectronics", "miningengineering", "mph", "mpt", "nanotechnology", 
//     "navalarchitecture", "neetmds", "neetpg", "neetss", "neetug", "nidentranceexam", 
//     "niftentranceexam", "nmat", "onlinemba", "paramedicalcourses", "parttimemba", 
//     "pearlaentranceexam", "petroleumengineering", "pharmacycourse",
 
//     "marineengineering", "mat", "materialsscience", "mba", "mbageneralmanagement", 
//     "mbainagriculture", "mbaindataanalytics", "mbaindatascience", "mbaindigitalmarketing", 
//     "mbainentrepreneurship", "mbainfamilybusiness", "mbainfinance", "mbainhealthcaremanagement", 
//     "mbainhrhumanresource", "mbaininternationalbusiness", "mbainitsystems", "mbainoperations", 
//     "mbainpharmaceuticalmanagement", "mbainsalesmarketing", "mbbs", "md", "mdes", 
//     "mechanicalengineering",
 
//     "fmge", "foodtechnology", "footweardesign", "furnituredesign", "gamedesign", 
//     "gate", "geneticengineering", "graphicdesign", "ibsat", "industrialengineering", 
//     "informationdesign", "informationtechnology", "inicet", "interiordesigning", 
//     "jeeadvanced", "jeemain", "jet", "jewellerydesign", "jutefibertechnology", 
//     "kiitee", "knitweardesign", "leatherdesign", "lifestyleaccessorydesign", "lpunest",
 
//     "cmat", "comedkuget", "communicationdesign", "communicationengineering", 
//     "computerscienceengineering", "constructionengineering", "controlsystems", 
//     "cucetchandigarhuniversity", "dairytechnology", "dental", "dieteticsnutrition", 
//     "diploma", "distancebtech", "distancediploma", "distancemba", "electricalengineering", 
//     "electronicscommunicationengineering", "electronicsengineering", "environmentalengineering", 
//     "executivemba", "exhibitiondesign", "fashiondesigning", "filmvideodesign",
//     "allindiaengineergollegedetails801_830", "allindiaengineergollegedetails831_850", 
//     "allindiaengineergollegedetails851_860", "allindiaengineergollegedetails861_890", 
//     "allindiaengineergollegedetails891_910", "allindiaengineergollegedetails911_920", 
//     "allindiaengineergollegedetails921_940", "allindiaengineergollegedetails941_960", 
//     "allindiaengineergollegedetails961_980", "allindiaengineergollegedetails981_1000", 
//     "allindiaengineergollegedetails1001_1020", "allindiaengineergollegedetails1021_1040", 
//     "allindiaengineergollegedetails1041_1060", "allindiaengineergollegedetails1061_1080", 
//     "allindiaengineergollegedetails1081_1100", "allindiaengineergollegedetails1101_1120", 
//     "allindiaengineergollegedetails1121_1140", "allindiaengineergollegedetails1141_1161", 
//     "allindiaengineergollegedetails1161_1180", "allindiaengineergollegedetails1181_1200", 
//     "allindiaengineergollegedetails1201_1240", "allindiaengineergollegedetails1221_1240", 
//     "allindiaengineergollegedetails1241_1260", "allindiaengineergollegedetails1261_1280",
 
//     "aeronauticalengineering", "aerospaceengineering", "aiapget", 
//     "aircraftmaintenanceengineering", "alldentalcollegedetails", "allEnexam4", 
//     "allEnexam70_118", "allEnexam118_166", "allfashionexam4", 
//     "allindiaengineergollegedetails1_20", "allindiaengineergollegedetails21_40", 
//     "allindiaengineergollegedetails41_60", "allindiaengineergollegedetails61_80", 
//     "allindiaengineergollegedetails81_100", "allindiaengineergollegedetails101_120", 
//     "allindiaengineergollegedetails121_140", "allindiaengineergollegedetails141_160", 
//     "allindiaengineergollegedetails161_180", "allindiaengineergollegedetails181_200", 
//     "allindiaengineergollegedetails201_220", "allindiaengineergollegedetails221_240", 
//     "allindiaengineergollegedetails241_260", "allindiaengineergollegedetails261_280",
 
//     "topengineeringcollegedetails161_200", "topengineeringcollegedetails201_240", 
//     "topengineeringcollegedetails241_280", "topengineeringcollegedetails281_297", 
//     "topfaishiondesgincollegedetails1_33", "topfaishiondesgincollegedetails34_56", 
//     "topmbacollegedetails1_40", "topmbacollegedetails41_80", "topmbacollegedetails81_all", 
//     "toydesign", "transportationengineering", "uceed", "uiux", "upcat", 
//     "visualmerchandising", "vlsidesign", "wbjee", "webdesign", "wudaptitudetext", "xat",
 
//     "alternativemedicine", "appareldesign", "atma", "automobileengineering", 
//     "automotivedesign", "bdes", "bdesfashion", "bdesinterior", "bebtech", 
//     "biomedicalengineering", "biotechnologyengineering", "bitsat", "bmlt", 
//     "bscfashion", "bscinteriordesign", "cat", "ceed", "ceramicengineering", 
//     "ceramicglass", "cgcuet", "chemicalengineering", "civilengineering", 
//     "clinicalpsychology", "clinicalresearch",
 
//     "allindiamedicalcollegedetails1981_2000", "allindiamedicalcollegedetails2001_2020", 
//     "allindiamedicalcollegedetails2021_2040", "allindiamedicalcollegedetails2041_2060", 
//     "allindiamedicalcollegedetails2061_2080", "allindiamedicalcollegedetails2081_2100", 
//     "allindiamedicalcollegedetails2161_2180", "allindiamedicalcollegedetails2181_2200", 
//     "allindiamedicalcollegedetails2201_2220", "allindiamedicalcollegedetails2221_2243", 
//     "allindiamedicalcollegedetails2245_2260", "allindiamedicalcollegedetails2261_2280", 
//     "allindiamedicalcollegedetails2281_2300", "allindiamedicalcollegedetails2301_2320", 
//     "allindiamedicalcollegedetails2321_2340", "allindiamedicalcollegedetails2341_2360", 
//     "allindiamedicalcollegedetails2361_2380", "allindiamedicalcollegedetails2381_2400", 
//     "allindiamedicalcollegedetails2401_2420", "allindiamedicalcollegedetails2421_2440", 
//     "allindiamedicalcollegedetails2441_2460", "allindiamedicalcollegedetails2461_2480", 
//     "allindiamedicalcollegedetails2481_2500", "allindiamedicalcollegedetails2501_2520",
//     "allindiamedicalcollegedetails2521_2540", "allindiamedicalcollegedetails3501_3520", 
//     "allindiamedicalcollegedetails3661_3680", "allindiamedicalcollegedetails3881_3900", 
//     "allindiamedicalcollegedetails4141_4160", "allindiamedicalcollegedetails4421_4440", 
//     "allindiamedicalcollegedetails4481_4488", "allmbaexam4", "allmedicalcollegedetails",
//     "allindiamedicalcollegedetails1501_1520", "allindiamedicalcollegedetails1521_1540", 
//     "allindiamedicalcollegedetails1541_1560", "allindiamedicalcollegedetails1561_1580", 
//     "allindiamedicalcollegedetails1581_1600", "allindiamedicalcollegedetails1601_1620", 
//     "allindiamedicalcollegedetails1621_1640", "allindiamedicalcollegedetails1641_1660", 
//     "allindiamedicalcollegedetails1661_1680", "allindiamedicalcollegedetails1681_1700", 
//     "allindiamedicalcollegedetails1701_1720", "allindiamedicalcollegedetails1721_1740", 
//     "allindiamedicalcollegedetails1741_1760", "allindiamedicalcollegedetails1761_1780", 
//     "allindiamedicalcollegedetails1781_1800", "allindiamedicalcollegedetails1801_1820", 
//     "allindiamedicalcollegedetails1821_1840", "allindiamedicalcollegedetails1841_1860", 
//     "allindiamedicalcollegedetails1861_1880", "allindiamedicalcollegedetails1881_1900", 
//     "allindiamedicalcollegedetails1901_1920", "allindiamedicalcollegedetails1921_1940", 
//     "allindiamedicalcollegedetails1941_1960", "allindiamedicalcollegedetails1961_1980",
 
//     "allindiamedicalcollegedetails1001_1020", "allindiamedicalcollegedetails1021_1040", 
//     "allindiamedicalcollegedetails1041_1060", "allindiamedicalcollegedetails1061_1080", 
//     "allindiamedicalcollegedetails1081_1100", "allindiamedicalcollegedetails1101_1120", 
//     "allindiamedicalcollegedetails1121_1140", "allindiamedicalcollegedetails1141_1160", 
//     "allindiamedicalcollegedetails1161_1180", "allindiamedicalcollegedetails1181_1200", 
//     "allindiamedicalcollegedetails1201_1220", "allindiamedicalcollegedetails1221_1240", 
//     "allindiamedicalcollegedetails1241_1260", "allindiamedicalcollegedetails1261_1280", 
//     "allindiamedicalcollegedetails1281_1300", "allindiamedicalcollegedetails1301_1320", 
//     "allindiamedicalcollegedetails1321_1340", "allindiamedicalcollegedetails1341_1360", 
//     "allindiamedicalcollegedetails1361_1380", "allindiamedicalcollegedetails1381_1400", 
//     "allindiamedicalcollegedetails1401_1420", "allindiamedicalcollegedetails1421_1440", 
//     "allindiamedicalcollegedetails1441_1460", "allindiamedicalcollegedetails1461_1480", 
//     "allindiamedicalcollegedetails1481_1500",
 
//     "allindiamedicalcollegedetails501_520", "allindiamedicalcollegedetails521_540", 
//     "allindiamedicalcollegedetails541_560", "allindiamedicalcollegedetails561_580", 
//     "allindiamedicalcollegedetails581_600", "allindiamedicalcollegedetails601_620", 
//     "allindiamedicalcollegedetails621_640", "allindiamedicalcollegedetails641_660", 
//     "allindiamedicalcollegedetails661_680", "allindiamedicalcollegedetails681_700", 
//     "allindiamedicalcollegedetails701_720", "allindiamedicalcollegedetails721_740", 
//     "allindiamedicalcollegedetails741_760", "allindiamedicalcollegedetails761_780", 
//     "allindiamedicalcollegedetails781_800", "allindiamedicalcollegedetails801_820", 
//     "allindiamedicalcollegedetails821_840", "allindiamedicalcollegedetails841_860", 
//     "allindiamedicalcollegedetails861_880", "allindiamedicalcollegedetails881_900", 
//     "allindiamedicalcollegedetails901_920", "allindiamedicalcollegedetails921_940", 
//     "allindiamedicalcollegedetails941_960", "allindiamedicalcollegedetails961_980", 
//     "allindiamedicalcollegedetails981_1000",
 
//     "allindiamedicalcollegedetails1_20", "allindiamedicalcollegedetails21_40", 
//     "allindiamedicalcollegedetails41_60", "allindiamedicalcollegedetails61_80", 
//     "allindiamedicalcollegedetails81_100", "allindiamedicalcollegedetails101_120", 
//     "allindiamedicalcollegedetails121_140", "allindiamedicalcollegedetails141_160", 
//     "allindiamedicalcollegedetails161_180", "allindiamedicalcollegedetails181_200", 
//     "allindiamedicalcollegedetails201_220", "allindiamedicalcollegedetails221_240", 
//     "allindiamedicalcollegedetails241_260", "allindiamedicalcollegedetails261_280", 
//     "allindiamedicalcollegedetails281_300", "allindiamedicalcollegedetails301_320", 
//     "allindiamedicalcollegedetails321_340", "allindiamedicalcollegedetails341_360", 
//     "allindiamedicalcollegedetails361_380", "allindiamedicalcollegedetails381_400", 
//     "allindiamedicalcollegedetails401_420", "allindiamedicalcollegedetails421_440", 
//     "allindiamedicalcollegedetails441_460", "allindiamedicalcollegedetails461_480", 
//     "allindiamedicalcollegedetails481_500",
 
//     "allindiaengineergollegedetails1_20", "allindiaengineergollegedetails21_40", 
//     "allindiaengineergollegedetails41_60", "allindiaengineergollegedetails61_80", 
//     "allindiaengineergollegedetails81_100", "allindiaengineergollegedetails101_120", 
//     "allindiaengineergollegedetails121_140", "allindiaengineergollegedetails141_160", 
//     "allindiaengineergollegedetails161_180", "allindiaengineergollegedetails181_200", 
//     "allindiaengineergollegedetails201_220", "allindiaengineergollegedetails221_240", 
//     "allindiaengineergollegedetails241_260", "allindiaengineergollegedetails261_280",
//     "allindiamedicalcollegedetails3001_3020", "allindiamedicalcollegedetails3021_3040", 
//     "allindiamedicalcollegedetails3041_3060", "allindiamedicalcollegedetails3061_3080", 
//     "allindiamedicalcollegedetails3081_3100", "allindiamedicalcollegedetails3101_3120", 
//     "allindiamedicalcollegedetails3121_3140", "allindiamedicalcollegedetails3141_3160", 
//     "allindiamedicalcollegedetails3161_3180", "allindiamedicalcollegedetails3181_3200", 
//     "allindiamedicalcollegedetails3201_3220", "allindiamedicalcollegedetails3221_3240", 
//     "allindiamedicalcollegedetails3241_3260", "allindiamedicalcollegedetails3261_3280", 
//     "allindiamedicalcollegedetails3281_3300", "allindiamedicalcollegedetails3301_3320", 
//     "allindiamedicalcollegedetails3321_3340", "allindiamedicalcollegedetails3341_3360", 
//     "allindiamedicalcollegedetails3361_3380", "allindiamedicalcollegedetails3381_3400", 
//     "allindiamedicalcollegedetails3401_3420", "allindiamedicalcollegedetails3421_3440", 
//     "allindiamedicalcollegedetails3441_3460", "allindiamedicalcollegedetails3461_3480", 
//     "allindiamedicalcollegedetails3481_3500",

//     // # Image: 12.22.48 PM (Engineering Details 500-800)
//     "allindiaengineergollegedetails521_540", "allindiaengineergollegedetails541_560", 
//     "allindiaengineergollegedetails561_580", "allindiaengineergollegedetails581_600", 
//     "allindiaengineergollegedetails601_620", "allindiaengineergollegedetails621_640", 
//     "allindiaengineergollegedetails641_660", "allindiaengineergollegedetails661_680", 
//     "allindiaengineergollegedetails681_710", "allindiaengineergollegedetails711_740", 
//     "allindiaengineergollegedetails741_770", "allindiaengineergollegedetails771_800",
 
//     "allindiaengineergollegedetails281_300", "allindiaengineergollegedetails301_320", 
//     "allindiaengineergollegedetails321_340", "allindiaengineergollegedetails341_360", 
//     "allindiaengineergollegedetails361_380", "allindiaengineergollegedetails381_400", 
//     "allindiaengineergollegedetails401_420", "allindiaengineergollegedetails421_440", 
//     "allindiaengineergollegedetails441_460", "allindiaengineergollegedetails461_480", 
//     "allindiaengineergollegedetails481_500", "allindiaengineergollegedetails501_520"
         
//     ];


// let cacheData = null;

// export const globalSearch = async (req, res) => {
    
//     const search = req.query.search?.toLowerCase().trim() || "";
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
    
//     const skip = (page - 1) * limit;
    
//     const collections = [
//      "mbatopcollege",
//      "btechtopcollege",
//      "lawcollege",
//      "allindiafashioncollegedetails1_20",
//      "allindiafashioncollegedetails21_40",
//      "allindiafashioncollegedetails41_60",
//      "allindiafashioncollegedetails61_80",
//      "allindiafashioncollegedetails81_100",
//      "allindiafashioncollegedetails101_120",
//      "allindiafashioncollegedetails121_140",
//      "allindiafashioncollegedetails141_160",
//      "allindiafashioncollegedetails161_180",
//      "allindiafashioncollegedetails181_200",
//      "allindiafashioncollegedetails201_220",
//      "allindiafashioncollegedetails221_240",
//      "allindiafashioncollegedetails241_260",
//      "allindiafashioncollegedetails261_280",
//      "allindiafashioncollegedetails281_300",
//      "allindiafashioncollegedetails301_320",
//      "allindiafashioncollegedetails321_340",
//      "allindiafashioncollegedetails341_360",
//      "allindiafashioncollegedetails361_380",
//      "allindiafashioncollegedetails381_400",
//      "allindiafashioncollegedetails401_420",
//      "allindiafashioncollegedetails421_440",
//      "allindiafashioncollegedetails441_460",
//      "allindiafashioncollegedetails461_480",
//      "allindiafashioncollegedetails481_500",
//      "allindiafashioncollegedetails501_520",
//      "allindiafashioncollegedetails521_540",
//      "allindiafashioncollegedetails541_560",
//      "allindiafashioncollegedetails561_580",
//      "allindiafashioncollegedetails581_600",
//      "allindiafashioncollegedetails601_620",
//      "allindiafashioncollegedetails621_640",
//      "allindiafashioncollegedetails641_660",
//      "allindiafashioncollegedetails661_680",
//      "allindiafashioncollegedetails681_700",
//      "allindiafashioncollegedetails701_720",
//      "allindiafashioncollegedetails721_740",
//      "allindiafashioncollegedetails741_760",
//      "allindiafashioncollegedetails761_780",
//      "allindiafashioncollegedetails781_800",
//      "allindiafashioncollegedetails801_820",
//      "allindiafashioncollegedetails821_840",
//      "allindiafashioncollegedetails841_860",
//      "allindiafashioncollegedetails861_880",
//      "allindiafashioncollegedetails881_900",
//      "allindiafashioncollegedetails901_920",
//      "allindiafashioncollegedetails921_940",
//      "allindiafashioncollegedetails941_960",
//      "allindiafashioncollegedetails961_980",
//      "allindiafashioncollegedetails981_1000",
//      "allindiafashioncollegedetails1001_1020",
//      "allindiafashioncollegedetails1021_1040",
//      "allindiafashioncollegedetails1041_1060",
//      "allindiafashioncollegedetails1061_1080",
//      "allindiafashioncollegedetails1081_1100",
//      "allindiafashioncollegedetails1101_1120",
//      "allindiafashioncollegedetails1121_1140",
//      "allindiafashioncollegedetails1141_1155",
//      "allindiamabacollegedetails1_40",
//      "allindiamabacollegedetails41_100",
//      "allindiamabacollegedetails101_140",
//      "allindiamabacollegedetails141_180",
//      "allindiamabacollegedetails181_220",
//      "allindiamabacollegedetails221_260",
//      "allindiamabacollegedetails261_300",
//      "allindiamabacollegedetails301_340",
//      "allindiamabacollegedetails341_370",
//      "allindiamabacollegedetails371_380",
//      "allindiamabacollegedetails381_420",
//      "allindiaengineercollegedetails1281_1300",
//      "allindiaengineercollegedetails1301_1320",
//      "allindiaengineercollegedetails1321_1340",
//      "allindiaengineercollegedetails1341_1360",
//      "allindiaengineercollegedetails1361_1380",
//      "allindiaengineercollegedetails1381_1400",
//      "allindiaengineercollegedetails1401_1420",
//      "allindiaengineercollegedetails1421_1440",
//      "allindiaengineercollegedetails1441_1460",
//      "allindiaengineercollegedetails1461_1480",
//      "allindiaengineercollegedetails1481_1500",
//      "allindiaengineercollegedetails1501_1520",
//      "allindiaengineercollegedetails1521_1540",
//      "allindiaengineercollegedetails1541_1560",
//      "allindiaengineercollegedetails1561_1580",
//      "allindiaengineercollegedetails1581_1600",
//      "allindiaengineercollegedetails1601_1620",
//      "allindiaengineercollegedetails1621_1640",
//      "allindiaengineercollegedetails1641_1680",
//      "allindiaengineercollegedetails1661_1680",
//      "allindiaengineercollegedetails1681_1700",
//      "allindiaengineercollegedetails1701_1720",
//      "allindiaengineercollegedetails1721_1740",
//      "allindiaengineercollegedetails1741_1760",
//      "allindiaengineercollegedetails1761_1780",
//      "allindiaengineercollegedetails1781_1800",
//      "allindiaengineercollegedetails1801_1820",
//      "allindiaengineercollegedetails1821_1840",
//      "allindiaengineercollegedetails1841_1860",
//      "allindiaengineercollegedetails1861_1880",
//      "allindiaengineercollegedetails1881_1900",
//      "allindiaengineercollegedetails1901_1920",
//      "allindiaengineercollegedetails1921_1940",
//      "allindiaengineercollegedetails1941_1960",
//      "allindiaengineercollegedetails1961_1980",
//      "allindiaengineercollegedetails1981_2000",
//      "allindiaengineercollegedetails2001_2020",
//      "allindiaengineercollegedetails2021_2040",
//      "allindiaengineercollegedetails2041_2060",
//      "allindiaengineercollegedetails2061_2080",
//      "allindiaengineercollegedetails2081_2100",
//      "allindiaengineercollegedetails2101_2120",
//      "allindiaengineercollegedetails2121_2140",
//      "allindiaengineercollegedetails2141_2160",
//      "allindiaengineercollegedetails2161_2180",
//      "allindiaengineercollegedetails2181_2200",
//      "allindiaengineercollegedetails2201_2220",
//      "allindiaengineercollegedetails2221_2240",
//      "allindiaengineercollegedetails2241_2260",
//      "allindiaengineercollegedetails2261_2273",
//      "aeronauticalengineering",
//      "aerospaceengineering",
//      "aiapget",
//      "aircraftmaintenanceengineering",
//      "alldentalcollegedetails",
//      "allEnexam4",
//      "allEnexam70_118",
//      "allEnexam118_166",
//      "allfashionexam4",
//      "allindiaengineergollegedetails1_20",
//      "allindiaengineergollegedetails21_40",
//      "allindiaengineergollegedetails41_60",
//      "allindiaengineergollegedetails61_80",
//      "allindiaengineergollegedetails81_100",
//      "allindiaengineergollegedetails101_120",
//      "allindiaengineergollegedetails121_140",
//      "allindiaengineergollegedetails141_160",
//      "allindiaengineergollegedetails161_180",
//      "allindiaengineergollegedetails181_200",
//      "allindiaengineergollegedetails201_220",
//      "allindiaengineergollegedetails221_240",
//      "allindiaengineergollegedetails241_260",
//      "allindiaengineergollegedetails261_280",
//      "allindiaengineergollegedetails281_300",
//      "allindiaengineergollegedetails301_320",
//      "allindiaengineergollegedetails321_340",
//      "allindiaengineergollegedetails341_360",
//      "allindiaengineergollegedetails361_380",
//      "allindiaengineergollegedetails381_400",
//      "allindiaengineergollegedetails401_420",
//      "allindiaengineergollegedetails421_440",
//      "allindiaengineergollegedetails441_460",
//      "allindiaengineergollegedetails461_480",
//      "allindiaengineergollegedetails481_500",
//      "allindiaengineergollegedetails501_520",
//      "allindiaengineergollegedetails521_540",
//      "allindiaengineergollegedetails541_560",
//      "allindiaengineergollegedetails561_580",
//      "allindiaengineergollegedetails581_600",
//      "allindiaengineergollegedetails601_620",
//      "allindiaengineergollegedetails621_640",
//      "allindiaengineergollegedetails641_660",
//      "allindiaengineergollegedetails661_680",
//      "allindiaengineergollegedetails681_710",
//      "allindiaengineergollegedetails711_740",
//      "allindiaengineergollegedetails741_770",
//      "allindiaengineergollegedetails771_800",
//      "allindiaengineergollegedetails801_830",
//      "allindiaengineergollegedetails831_850",
//      "allindiaengineergollegedetails851_860",
//      "allindiaengineergollegedetails861_890",
//      "allindiaengineergollegedetails891_910",
//      "allindiaengineergollegedetails911_920",
//      "allindiaengineergollegedetails921_940",
//      "allindiaengineergollegedetails941_960",
//      "allindiaengineergollegedetails961_980",
//      "allindiaengineergollegedetails981_1000",
//      "allindiaengineergollegedetails1001_1020",
//      "allindiaengineergollegedetails1021_1040",
//      "allindiaengineergollegedetails1041_1060",
//      "allindiaengineergollegedetails1061_1080",
//      "allindiaengineergollegedetails1081_1100",
//      "allindiaengineergollegedetails1101_1120",
//      "allindiaengineergollegedetails1121_1140",
//      "allindiaengineergollegedetails1141_1161",
//      "allindiaengineergollegedetails1161_1180",
//      "allindiaengineergollegedetails1181_1200",
//      "allindiaengineergollegedetails1201_1240",
//      "allindiaengineergollegedetails1221_1240",
//      "allindiaengineergollegedetails1241_1260",
//      "allindiaengineergollegedetails1261_1280",
//      "topengineeringcollegedetails161_200",
//      "topengineeringcollegedetails201_240",
//      "topengineeringcollegedetails241_280",
//      "topengineeringcollegedetails281_297",
//      "topfaishiondesgincollegedetails1_33",
//      "topfaishiondesgincollegedetails34_56",
//      "topmbacollegedetails1_40",
//      "topmbacollegedetails41_80",
//      "topmbacollegedetails81_all",
//      "toydesign",
//      "transportationengineering",
//      "uceed",
//      "uiux",
//      "upcat",
//      "visualmerchandising",
//      "vlsidesign",
//      "wbjee",
//      "webdesign",
//      "wudaptitudetext",
//      "xat",
//      "pharmancycollegedetails1_40",
//      "pharmancycollegedetails41_80",
//      "pharmancycollegedetails81_125",
//      "phd",
//      "physiotherapy",
//      "powerengineering",
//      "productdesign",
//      "productionengineering",
//      "productmanagement",
//      "publichealthmanagement",
//      "pulppapertechnology",
//      "rfmicrowaveengineering",
//      "roboticsengineering",
//      "snap",
//      "structuralengineering",
//      "telecommunicationengineering",
//      "textiledesign",
//      "textileengineering",
//      "toolengineering",
//      "topengineeringcollegedetails1_40",
//      "topengineeringcollegedetails41_80",
//      "topengineeringcollegedetails81_120",
//      "topengineeringcollegedetails121_160",
//      "mechatronicsengineering",
//      "medicine",
//      "memtech",
//      "metallurgicalengineering",
//      "microelectronics",
//      "miningengineering",
//      "mph",
//      "mpt",
//      "nanotechnology",
//      "navalarchitecture",
//      "neetmds",
//      "neetpg",
//      "neetss",
//      "neetug",
//      "nidentranceexam",
//      "niftentranceexam",
//      "nmat",
//      "onlinemba",
//      "paramedicalcourses",
//      "parttimemba",
//      "pearlaentranceexam",
//      "petroleumengineering",
//      "pharmacycourse",
//      "marineengineering",
//      "mat",
//      "materialsscience",
//      "mba",
//      "mbageneralmanagement",
//      "mbainagriculture",
//      "mbaindataanalytics",
//      "mbaindatascience",
//      "mbaindigitalmarketing",
//      "mbainentrepreneurship",
//      "mbainfamilybusiness",
//      "mbainfinance",
//      "mbainhealthcaremanagement",
//      "mbainhrhumanresource",
//      "mbaininternationalbusiness",
//      "mbainitsystems",
//      "mbainoperations",
//      "mbainpharmaceuticalmanagement",
//      "mbainsalesmarketing",
//      "mbbs",
//      "md",
//      "mdes",
//      "mechanicalengineering",
//      "fmge",
//      "foodtechnology",
//      "footweardesign",
//      "furnituredesign",
//      "gamedesign",
//      "gate",
//      "geneticengineering",
//      "graphicdesign",
//      "ibsat",
//      "industrialengineering",
//      "informationdesign",
//      "informationtechnology",
//      "inicet",
//      "interiordesigning",
//      "jeeadvanced",
//      "jeemain",
//      "jet",
//      "jewellerydesign",
//      "jutefibertechnology",
//      "kiitee",
//      "knitweardesign",
//      "leatherdesign",
//      "lifestyleaccessorydesign",
//      "lpunest",
//      "cmat",
//      "comedkuget",
//      "communicationdesign",
//      "communicationengineering",
//      "computerscienceengineering",
//      "constructionengineering",
//      "controlsystems",
//      "cucetchandigarhuniversity",
//      "dairytechnology",
//      "dental",
//      "dieteticsnutrition",
//      "diploma",
//      "distancebtech",
//      "distancediploma",
//      "distancemba",
//      "electricalengineering",
//      "electronicscommunicationengineering",
//      "electronicsengineering",
//      "environmentalengineering",
//      "executivemba",
//      "exhibitiondesign",
//      "fashiondesigning",
//      "filmvideodesign",
//      "alternativemedicine",
//      "appareldesign",
//      "atma",
//      "automobileengineering",
//      "automotivedesign",
//      "bdes",
//      "bdesfashion",
//      "bdesinterior",
//      "bebtech",
//      "biomedicalengineering",
//      "biotechnologyengineering",
//      "bitsat",
//      "bmlt",
//      "bscfashion",
//      "bscinteriordesign",
//      "cat",
//      "ceed",
//      "ceramicengineering",
//      "ceramicglass",
//      "cgcuet",
//      "chemicalengineering",
//      "civilengineering",
//      "clinicalpsychology",
//      "clinicalresearch",
//      "allindiamedicalcollegedetails1981_2000",
//      "allindiamedicalcollegedetails2001_2020",
//      "allindiamedicalcollegedetails2021_2040",
//      "allindiamedicalcollegedetails2041_2060",
//      "allindiamedicalcollegedetails2061_2080",
//      "allindiamedicalcollegedetails2081_2100",
//      "allindiamedicalcollegedetails2161_2180",
//      "allindiamedicalcollegedetails2181_2200",
//      "allindiamedicalcollegedetails2201_2220",
//      "allindiamedicalcollegedetails2221_2243",
//      "allindiamedicalcollegedetails2245_2260",
//      "allindiamedicalcollegedetails2261_2280",
//      "allindiamedicalcollegedetails2281_2300",
//      "allindiamedicalcollegedetails2301_2320",
//      "allindiamedicalcollegedetails2321_2340",
//      "allindiamedicalcollegedetails2341_2360",
//      "allindiamedicalcollegedetails2361_2380",
//      "allindiamedicalcollegedetails2381_2400",
//      "allindiamedicalcollegedetails2401_2420",
//      "allindiamedicalcollegedetails2421_2440",
//      "allindiamedicalcollegedetails2441_2460",
//      "allindiamedicalcollegedetails2461_2480",
//      "allindiamedicalcollegedetails2481_2500",
//      "allindiamedicalcollegedetails2501_2520",
//      "allindiamedicalcollegedetails2521_2540",
//      "allindiamedicalcollegedetails3501_3520",
//      "allindiamedicalcollegedetails3661_3680",
//      "allindiamedicalcollegedetails3881_3900",
//      "allindiamedicalcollegedetails4141_4160",
//      "allindiamedicalcollegedetails4421_4440",
//      "allindiamedicalcollegedetails4481_4488",
//      "allmbaexam4",
//      "allmedicalcollegedetails",
//      "allindiamedicalcollegedetails1501_1520",
//      "allindiamedicalcollegedetails1521_1540",
//      "allindiamedicalcollegedetails1541_1560",
//      "allindiamedicalcollegedetails1561_1580",
//      "allindiamedicalcollegedetails1581_1600",
//      "allindiamedicalcollegedetails1601_1620",
//      "allindiamedicalcollegedetails1621_1640",
//      "allindiamedicalcollegedetails1641_1660",
//      "allindiamedicalcollegedetails1661_1680",
//      "allindiamedicalcollegedetails1681_1700",
//      "allindiamedicalcollegedetails1701_1720",
//      "allindiamedicalcollegedetails1721_1740",
//      "allindiamedicalcollegedetails1741_1760",
//      "allindiamedicalcollegedetails1761_1780",
//      "allindiamedicalcollegedetails1781_1800",
//      "allindiamedicalcollegedetails1801_1820",
//      "allindiamedicalcollegedetails1821_1840",
//      "allindiamedicalcollegedetails1841_1860",
//      "allindiamedicalcollegedetails1861_1880",
//      "allindiamedicalcollegedetails1881_1900",
//      "allindiamedicalcollegedetails1901_1920",
//      "allindiamedicalcollegedetails1921_1940",
//      "allindiamedicalcollegedetails1941_1960",
//      "allindiamedicalcollegedetails1961_1980",
//      "allindiamedicalcollegedetails1001_1020",
//      "allindiamedicalcollegedetails1021_1040",
//      "allindiamedicalcollegedetails1041_1060",
//      "allindiamedicalcollegedetails1061_1080",
//      "allindiamedicalcollegedetails1081_1100",
//      "allindiamedicalcollegedetails1101_1120",
//      "allindiamedicalcollegedetails1121_1140",
//      "allindiamedicalcollegedetails1141_1160",
//      "allindiamedicalcollegedetails1161_1180",
//      "allindiamedicalcollegedetails1181_1200",
//      "allindiamedicalcollegedetails1201_1220",
//      "allindiamedicalcollegedetails1221_1240",
//      "allindiamedicalcollegedetails1241_1260",
//      "allindiamedicalcollegedetails1261_1280",
//      "allindiamedicalcollegedetails1281_1300",
//      "allindiamedicalcollegedetails1301_1320",
//      "allindiamedicalcollegedetails1321_1340",
//      "allindiamedicalcollegedetails1341_1360",
//      "allindiamedicalcollegedetails1361_1380",
//      "allindiamedicalcollegedetails1381_1400",
//      "allindiamedicalcollegedetails1401_1420",
//      "allindiamedicalcollegedetails1421_1440",
//      "allindiamedicalcollegedetails1441_1460",
//      "allindiamedicalcollegedetails1461_1480",
//      "allindiamedicalcollegedetails1481_1500",
//      "allindiamedicalcollegedetails501_520",
//      "allindiamedicalcollegedetails521_540",
//      "allindiamedicalcollegedetails541_560",
//      "allindiamedicalcollegedetails561_580",
//      "allindiamedicalcollegedetails581_600",
//      "allindiamedicalcollegedetails601_620",
//      "allindiamedicalcollegedetails621_640",
//      "allindiamedicalcollegedetails641_660",
//      "allindiamedicalcollegedetails661_680",
//      "allindiamedicalcollegedetails681_700",
//      "allindiamedicalcollegedetails701_720",
//      "allindiamedicalcollegedetails721_740",
//      "allindiamedicalcollegedetails741_760",
//      "allindiamedicalcollegedetails761_780",
//      "allindiamedicalcollegedetails781_800",
//      "allindiamedicalcollegedetails801_820",
//      "allindiamedicalcollegedetails821_840",
//      "allindiamedicalcollegedetails841_860",
//      "allindiamedicalcollegedetails861_880",
//      "allindiamedicalcollegedetails881_900",
//      "allindiamedicalcollegedetails901_920",
//      "allindiamedicalcollegedetails921_940",
//      "allindiamedicalcollegedetails941_960",
//      "allindiamedicalcollegedetails961_980",
//      "allindiamedicalcollegedetails981_1000",
//      "allindiamedicalcollegedetails1_20",
//      "allindiamedicalcollegedetails21_40",
//      "allindiamedicalcollegedetails41_60",
//      "allindiamedicalcollegedetails61_80",
//      "allindiamedicalcollegedetails81_100",
//      "allindiamedicalcollegedetails101_120",
//      "allindiamedicalcollegedetails121_140",
//      "allindiamedicalcollegedetails141_160",
//      "allindiamedicalcollegedetails161_180",
//      "allindiamedicalcollegedetails181_200",
//      "allindiamedicalcollegedetails201_220",
//      "allindiamedicalcollegedetails221_240",
//      "allindiamedicalcollegedetails241_260",
//      "allindiamedicalcollegedetails261_280",
//      "allindiamedicalcollegedetails281_300",
//      "allindiamedicalcollegedetails301_320",
//      "allindiamedicalcollegedetails321_340",
//      "allindiamedicalcollegedetails341_360",
//      "allindiamedicalcollegedetails361_380",
//      "allindiamedicalcollegedetails381_400",
//      "allindiamedicalcollegedetails401_420",
//      "allindiamedicalcollegedetails421_440",
//      "allindiamedicalcollegedetails441_460",
//      "allindiamedicalcollegedetails461_480",
//      "allindiamedicalcollegedetails481_500",
//      "allindiamedicalcollegedetails3001_3020",
//      "allindiamedicalcollegedetails3021_3040",
//      "allindiamedicalcollegedetails3041_3060",
//      "allindiamedicalcollegedetails3061_3080",
//      "allindiamedicalcollegedetails3081_3100",
//      "allindiamedicalcollegedetails3101_3120",
//      "allindiamedicalcollegedetails3121_3140",
//      "allindiamedicalcollegedetails3141_3160",
//      "allindiamedicalcollegedetails3161_3180",
//      "allindiamedicalcollegedetails3181_3200",
//      "allindiamedicalcollegedetails3201_3220",
//      "allindiamedicalcollegedetails3221_3240",
//      "allindiamedicalcollegedetails3241_3260",
//      "allindiamedicalcollegedetails3261_3280",
//      "allindiamedicalcollegedetails3281_3300",
//      "allindiamedicalcollegedetails3301_3320",
//      "allindiamedicalcollegedetails3321_3340",
//      "allindiamedicalcollegedetails3341_3360",
//      "allindiamedicalcollegedetails3361_3380",
//      "allindiamedicalcollegedetails3381_3400",
//      "allindiamedicalcollegedetails3401_3420",
//      "allindiamedicalcollegedetails3421_3440",
//      "allindiamedicalcollegedetails3441_3460",
//      "allindiamedicalcollegedetails3461_3480",
//      "allindiamedicalcollegedetails3481_3500"
//     ]
   

//     try {
 
//         const promises = collections.map(async (col) => {
//             try {
//                 const command = new GetObjectCommand({
//                     Bucket: process.env.AWS_BUCKET_NAME,
//                     Key: col,
//                 });

//                 const data = await s3.send(command);
//                 if (!data.Body) return [];

//                 const body = await streamToString(data.Body);
//                 const jsonData = JSON.parse(body);

//                 let arr = [];

//                 if (Array.isArray(jsonData)) {
//                     arr = jsonData;
//                 } else if (jsonData.data) {
//                     arr = jsonData.data;
//                 } else {
//                     arr = Object.values(jsonData);
//                 }

//                 let colleges = [];

//                 arr.forEach(item => {
//                     if (item.colleges && Array.isArray(item.colleges)) {
//                         colleges.push(...item.colleges);
//                     }
//                 });

//                 return colleges;

//             } catch (err) {
//                 return []; // skip missing file
//             }
//         });
 
//         const results = await Promise.all(promises);
 
//         const allColleges = results.flat();
 
//         let filtered = allColleges;

//         if (search) {
//             filtered = allColleges.filter(college =>
//                 Object.values(college).some(val =>
//                     String(val).toLowerCase().includes(search)
//                 )
//             );
//         }
 
//         const total = filtered.length;
//         const paginated = filtered.slice(skip, skip + limit);

//         res.json({
//             total,
//             page,
//             limit,
//             totalPages: Math.ceil(total / limit),
//             data: paginated
//         });

//     } catch (err) {
//         console.log("Global search error:", err.message);
//         res.status(500).json({ error: err.message });
//     }
// };