import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

export const signAdminToken = (adminUser) =>
  jwt.sign(
    { sub: adminUser._id.toString(), role: adminUser.role, tokenVersion: adminUser.tokenVersion || 0 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

export const verifyAdminToken = (token) => jwt.verify(token, JWT_SECRET);
