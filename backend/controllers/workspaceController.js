// workspaceController.js
import Workspace from '../models/workspaceModel.js'
import User from '../models/userModel.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const generateInitials = (name = "") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

const generateInviteCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();

// ─────────────────────────────────────────────────────────────────────────────
// CREATE WORKSPACE
// POST /api/workspaces
// ─────────────────────────────────────────────────────────────────────────────

const createWorkspace = async (req, res) => {
  try {
    const { name, industry, description, color, size, website, location, phone } = req.body;
    const userId = req.user.id; // from auth middleware

    if (!name?.trim()) return res.status(400).json({ message: "Business name is required." });
    if (!industry?.trim()) return res.status(400).json({ message: "Industry is required." });

    const workspace = await Workspace.create({
      name: name.trim(),
      industry: industry.trim(),
      description: description?.trim() ?? "",
      initials: generateInitials(name),
      color: color ?? "#1a3a6b",
      size: size ?? "",
      website: website?.trim() ?? "",
      location: location?.trim() ?? "",
      phone: phone?.trim() ?? "",
      owner: userId,
      inviteCode: generateInviteCode(),
      verified: false,
      members: [{ user: userId, role: "Owner" }],
      activeTasks: 0,
    });

    // Add workspace to user's ownedWorkspaces
    await User.findByIdAndUpdate(userId, {
      $push: { ownedWorkspaces: workspace._id },
    });

    res.status(201).json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET MY WORKSPACES (owned + joined)
// GET /api/workspaces/my
// ─────────────────────────────────────────────────────────────────────────────

const getMyWorkspaces = async (req, res) => {
  try {
    const userId = req.user.id;

    const myBusinesses = await Workspace.find({ owner: userId })
      .populate("owner", "name email avatar")
      .lean();

    const joinedBusinesses = await Workspace.find({
      "members.user": userId,
      owner: { $ne: userId },
    })
      .populate("owner", "name email avatar")
      .lean();

    res.status(200).json({ success: true, myBusinesses, joinedBusinesses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE WORKSPACE
// GET /api/workspaces/:id
// ─────────────────────────────────────────────────────────────────────────────

const getWorkspace = async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id)
      .populate("owner", "name email avatar")
      .populate("members.user", "name email avatar");

    if (!workspace) return res.status(404).json({ message: "Workspace not found." });

    res.status(200).json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE WORKSPACE
// PUT /api/workspaces/:id
// ─────────────────────────────────────────────────────────────────────────────

const updateWorkspace = async (req, res) => {
  try {
    const userId = req.user.id;

    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ message: "Workspace not found." });
    if (workspace.owner.toString() !== userId)
      return res.status(403).json({ message: "Only the owner can edit this workspace." });

    const { name, industry, description, color, size, website, location, phone } = req.body;

    if (name) {
      workspace.name = name.trim();
      workspace.initials = generateInitials(name);
    }
    if (industry) workspace.industry = industry.trim();
    if (description !== undefined) workspace.description = description.trim();
    if (color) workspace.color = color;
    if (size) workspace.size = size;
    if (website !== undefined) workspace.website = website.trim();
    if (location !== undefined) workspace.location = location.trim();
    if (phone !== undefined) workspace.phone = phone.trim();

    await workspace.save();

    res.status(200).json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE WORKSPACE
// DELETE /api/workspaces/:id
// ─────────────────────────────────────────────────────────────────────────────

const deleteWorkspace = async (req, res) => {
  try {
    const userId = req.user.id;

    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ message: "Workspace not found." });
    if (workspace.owner.toString() !== userId)
      return res.status(403).json({ message: "Only the owner can delete this workspace." });

    await workspace.deleteOne();

    await User.findByIdAndUpdate(userId, {
      $pull: { ownedWorkspaces: workspace._id },
    });

    res.status(200).json({ success: true, message: "Workspace deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// JOIN WORKSPACE VIA INVITE CODE
// POST /api/workspaces/join
// ─────────────────────────────────────────────────────────────────────────────

const joinWorkspace = async (req, res) => {
  try {
    const userId = req.user.id;
    const { inviteCode, role = "Member" } = req.body;

    if (!inviteCode) return res.status(400).json({ message: "Invite code is required." });

    const workspace = await Workspace.findOne({ inviteCode: inviteCode.toUpperCase() });
    if (!workspace) return res.status(404).json({ message: "Invalid invite code." });

    if (workspace.owner.toString() === userId)
      return res.status(400).json({ message: "You are the owner of this workspace." });

    const alreadyMember = workspace.members.some((m) => m.user.toString() === userId);
    if (alreadyMember)
      return res.status(400).json({ message: "You are already a member of this workspace." });

    workspace.members.push({ user: userId, role });
    await workspace.save();

    await User.findByIdAndUpdate(userId, {
      $push: { joinedWorkspaces: workspace._id },
    });

    res.status(200).json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE WORKSPACE
// POST /api/workspaces/:id/leave
// ─────────────────────────────────────────────────────────────────────────────

const leaveWorkspace = async (req, res) => {
  try {
    const userId = req.user.id;

    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ message: "Workspace not found." });

    if (workspace.owner.toString() === userId)
      return res.status(400).json({ message: "Owner cannot leave. Transfer ownership or delete the workspace." });

    workspace.members = workspace.members.filter((m) => m.user.toString() !== userId);
    await workspace.save();

    await User.findByIdAndUpdate(userId, {
      $pull: { joinedWorkspaces: workspace._id },
    });

    res.status(200).json({ success: true, message: "Left workspace successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE MEMBER  (owner only)
// DELETE /api/workspaces/:id/members/:memberId
// ─────────────────────────────────────────────────────────────────────────────

const removeMember = async (req, res) => {
  try {
    const userId = req.user.id;
    const { memberId } = req.params;

    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ message: "Workspace not found." });
    if (workspace.owner.toString() !== userId)
      return res.status(403).json({ message: "Only the owner can remove members." });
    if (memberId === userId)
      return res.status(400).json({ message: "Owner cannot remove themselves." });

    workspace.members = workspace.members.filter((m) => m.user.toString() !== memberId);
    await workspace.save();

    await User.findByIdAndUpdate(memberId, {
      $pull: { joinedWorkspaces: workspace._id },
    });

    res.status(200).json({ success: true, message: "Member removed." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REGENERATE INVITE CODE  (owner only)
// PATCH /api/workspaces/:id/invite-code
// ─────────────────────────────────────────────────────────────────────────────

const regenerateInviteCode = async (req, res) => {
  try {
    const userId = req.user.id;

    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ message: "Workspace not found." });
    if (workspace.owner.toString() !== userId)
      return res.status(403).json({ message: "Only the owner can regenerate the invite code." });

    workspace.inviteCode = generateInviteCode();
    await workspace.save();

    res.status(200).json({ success: true, inviteCode: workspace.inviteCode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

export  {
  createWorkspace,
  getMyWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  joinWorkspace,
  leaveWorkspace,
  removeMember,
  regenerateInviteCode,
};