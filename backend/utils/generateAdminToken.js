import jwt from "jsonwebtoken";

const generateAdminToken = (res, adminId) => {
  const token = jwt.sign(
    { adminId },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: "30d" }
  );

  const isProd = process.env.NODE_ENV === "production";

  res.cookie("admin_jwt", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  return token;
};

export default generateAdminToken;