import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

//routes
import userRoutes from "./routes/userRoutes.js";
import workspaceRoutes from './routes/workspaceRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import messagingRoutes from './routes/messagingRoutes.js';
import projectRoutes from './routes/projectRoutes.js';

import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import { initSocket } from "./controllers/socket.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8000;
const MONGO_URL = process.env.MONGO_URL;

// ✅ Parse first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ✅ CORS FIRST (must be before routes)
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
app.use('/api/message', messagingRoutes);
app.use('/api/projects', projectRoutes);

// ✅ Error middleware order (notFound first)
app.use(notFound);
app.use(errorHandler);

// ✅ Mongo + server start with Socket.io
mongoose
  .connect(MONGO_URL)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    
    // Initialize Socket.io after MongoDB connection
    const io = initSocket(server);
    
    // Make io available to routes if needed
    app.set('io', io);
    
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
      console.log(`✅ Socket.io ready for connections`);
    });
  })
  .catch((err) => console.error("❌ Mongo error:", err.message));