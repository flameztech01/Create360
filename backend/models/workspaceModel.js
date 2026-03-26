// models/Workspace.js
import mongoose from "mongoose";

const memberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, default: "Member" },
  status: { 
    type: String, 
    enum: ["pending", "active", "inactive"], 
    default: "active" 
  },
  department: { 
    type: String, 
    default: "General" 
  },
  joinedAt: { type: Date, default: Date.now },
});

const workspaceSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    industry:    { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    initials:    { type: String },
    color:       { type: String, default: "#1a3a6b" },
    size:        { type: String, default: "" },
    website:     { type: String, default: "" },
    location:    { type: String, default: "" },
    phone:       { type: String, default: "" },
    owner:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members:     [memberSchema],
    activeTasks: { type: Number, default: 0 },
    inviteCode:  { type: String, unique: true },
    verified:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Index for faster queries
workspaceSchema.index({ inviteCode: 1 });
workspaceSchema.index({ owner: 1 });
workspaceSchema.index({ "members.user": 1 });
workspaceSchema.index({ "members.status": 1 });

const Workspace = mongoose.model("Workspace", workspaceSchema);
export default Workspace;