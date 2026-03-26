import User from "../models/userModel.js";
import asyncHandler from "express-async-handler";
import generateToken from "../utils/generateToken.js";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client();

const getUserInfoFromAccessToken = async (accessToken) => {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch user info from Google");
  }

  return response.json();
};

const googleAuth = asyncHandler(async (req, res) => {
  const { token: googleToken, phone, mode } = req.body;

  if (!googleToken) {
    res.status(400);
    throw new Error("Google token is required");
  }

  if (!mode || !["signup", "login"].includes(mode)) {
    res.status(400);
    throw new Error("Valid mode is required");
  }

  let googleId = "";
  let email = "";
  let name = "";
  let picture = "";

  // ── Verify token — supports idToken from Web, Android & iOS ──────────────
  try {
    const audiences = [
      process.env.GOOGLE_WEB_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
    ].filter(Boolean); // removes undefined entries

    const ticket = await googleClient.verifyIdToken({
      idToken: googleToken,
      audience: audiences,
    });

    const payload = ticket.getPayload();

    googleId = payload?.sub || "";
    email = payload?.email || "";
    name = payload?.name || "";
    picture = payload?.picture || "";

    console.log("[googleAuth] idToken verified for:", email);
  } catch (idTokenError) {
    // Fallback — accessToken flow (older Android / web flow)
    console.log("[googleAuth] idToken failed, trying accessToken:", idTokenError.message);

    try {
      const userInfo = await getUserInfoFromAccessToken(googleToken);

      googleId = userInfo?.sub || `google-${userInfo?.email || Date.now()}`;
      email = userInfo?.email || "";
      name = userInfo?.name || "";
      picture = userInfo?.picture || "";

      console.log("[googleAuth] accessToken verified for:", email);
    } catch (accessTokenError) {
      res.status(401);
      throw new Error("Invalid Google token. Please try again.");
    }
  }

  if (!email) {
    res.status(400);
    throw new Error("Google account email is required");
  }

  let user = await User.findOne({
    $or: [{ googleId }, { email }],
  });

  // ── SIGNUP ────────────────────────────────────────────────────────────────
  if (mode === "signup") {
    const cleanedPhone = String(phone || "").trim();

    if (!cleanedPhone) {
      res.status(400);
      throw new Error("Phone number is required");
    }

    if (user) {
      res.status(400);
      throw new Error("Account already exists. Please login instead.");
    }

    const baseUsername = (email?.split("@")[0] || name || "user")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9_]/g, "") || "user";

    let username = baseUsername;
    let counter = 1;

    while (await User.findOne({ username })) {
      username = `${baseUsername}${counter++}`;
    }

    user = await User.create({
      googleId,
      name: name || "",
      username,
      email,
      phone: cleanedPhone,
      profile: picture || "",
      password: `google-auth-${googleId}`,
      isVerified: true,
      authMethod: "google",
      ownedWorkspaces: [],
      joinedWorkspaces: [],
    });
  }

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  if (mode === "login") {
    if (!user) {
      res.status(404);
      throw new Error("No account found with this email. Please sign up first.");
    }

    if (!user.googleId) user.googleId = googleId;
    if (!user.profile && picture) user.profile = picture;
    if (!user.name && name) user.name = name;

    user.isVerified = true;
    user.authMethod = "google";
    await user.save();
  }

  const token = generateToken(res, user._id);

  res.status(200).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    profile: user.profile,
    authMethod: user.authMethod,
    token,
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const { name } = req.body;
  const profilePicture = req.file?.path; // Cloudinary returns the URL in req.file.path

  if (name) user.name = name;
  if (profilePicture) user.profile = profilePicture;

  const updatedUser = await user.save();

  res.status(200).json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    phone: updatedUser.phone,
    profile: updatedUser.profile,
    authMethod: updatedUser.authMethod,
  });
});

const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({}).select("-password").sort({ createdAt: -1 });
  res.status(200).json(users);
});

const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  
  res.status(200).json(user);
});

const logoutUser = asyncHandler(async (req, res) => {
  const isProd = process.env.NODE_ENV === "production";

  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });

  res.status(200).json({ message: "Logged out successfully" });
});

export { googleAuth, updateProfile, getUsers, getUserById,  logoutUser };
