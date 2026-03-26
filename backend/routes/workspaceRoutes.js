// routes/workspaceRoutes.js

import express from 'express'
import { protect } from "../middleware/authMiddleware.js";
import {
  createWorkspace,
  getMyWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  leaveWorkspace,
  removeMember,
  regenerateInviteCode,
  migrateWorkspaces,
} from "../controllers/workspaceController.js";

const router = express.Router();

router.post("/",              protect, createWorkspace);
router.get("/my",             protect, getMyWorkspaces);
router.get("/:id",            protect, getWorkspace);
router.put("/:id",            protect, updateWorkspace);
router.delete("/:id",         protect, deleteWorkspace);
router.post("/:id/leave",     protect, leaveWorkspace);
router.delete("/:id/members/:memberId", protect, removeMember);
router.patch("/:id/invite-code", protect, regenerateInviteCode);
router.post("/migrate",       protect, migrateWorkspaces);

export default router;