import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

//routes
import userRoutes from "./routes/userRoutes.js";
import workspaceRoutes from './routes/workspaceRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import taskRoutes from './routes/taskRoutes.js';

import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const MONGO_URL = process.env.MONGO_URL;

// ✅ Parse first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ✅ CORS FIRST (must be before routes)
// const allowedOrigins = process.env.NODE_ENV === 'production'
//     ? ['http://localhost:8081', 'exp://10.187.119.227:8081']
//     : ['http://localhost:8081', 'exp://10.187.119.227:8081'];

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// ✅ Health test endpoint
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend is reachable" });
});

// ✅ Routes
app.use("/api/user", userRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/tasks', taskRoutes);

// ✅ Error middleware order (notFound first)
app.use(notFound);
app.use(errorHandler);

// ✅ Mongo + server start
mongoose
  .connect(MONGO_URL)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    app.listen(PORT, "0.0.0.0", () =>
      console.log(`✅ Server running on http://0.0.0.0:${PORT}`),
    );
  })
  .catch((err) => console.error("❌ Mongo error:", err.message));
