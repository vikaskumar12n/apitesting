import jwt from "jsonwebtoken";

const getJwtSecret = () => process.env.SECRET_KEY || "jWttoken";

export const optionalAuth = (req, res, next) => {
    const authorization = req.headers.authorization;

    if (!authorization) {
        return next();
    }

    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ message: "Invalid authorization header" });
    }

    try {
        req.user = jwt.verify(token, getJwtSecret());
        return next();
    } catch {
        return res.status(401).json({ message: "Invalid token" });
    }
};
export const verifyToken = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res.status(401).json({ message: "Unauthorized " });
        }

        const decoded = jwt.verify(token, getJwtSecret());

        req.user = decoded;

        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid token " });
    }
};

export const requireUser = (req, res, next) => {
    if (req.user?.role !== "user") {
        return res.status(403).json({
            message: "Only user accounts can apply to colleges"
        });
    }

    next();
};
export const requireCollege = (req, res, next) => {
    if (req.user?.role !== "college") {
        return res.status(403).json({
            message: "Only college accounts can access assigned students"
        });
    }

    next();
};
export const requireAdmin = (req, res, next) => {
    if (req.user?.role !== "admin" && req.user?.isAdmin !== true) {
        return res.status(403).json({
            message: "Only an admin can perform this action"
        });
    }

    next();
};