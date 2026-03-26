// models/Workspace.js
import mongoose from "mongoose";

const memberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, default: "Member" },
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

const Workspace = mongoose.model("Workspace", workspaceSchema);
export default Workspace;