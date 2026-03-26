import express from "express";
import { 
  googleAuth, 
  logoutUser, 
  updateProfile, 
  getUsers, 
  getUserById  // Add this import
} from "../controllers/userController.js";
import {protect, adminProtect} from "../middleware/authMiddleware.js";

import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const router = express.Router();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Multer -> Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "Create360_ProfilePicture",
    allowed_formats: ["jpg", "png", "jpeg", "webp", "avif"],
  },
});

const upload = multer({ storage });

// Optional: test connection (DON'T block server startup if it fails)
cloudinary.api
  .ping()
  .then(() => console.log("✅ Cloudinary connected successfully"))
  .catch((err) => console.error("❌ Cloudinary not connected:", err.message));

// Public routes
router.post("/google", googleAuth);
router.post("/logout", logoutUser);

// Protected routes
router.put("/profile", protect, upload.single('profile'), updateProfile);
router.get("/:id", protect, getUserById); // Get user by ID - this should come before the admin routes

// Admin routes
router.get("/", adminProtect, getUsers);

export default router;