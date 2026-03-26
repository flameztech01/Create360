// routes/workspaceRoutes.js

import express from 'express'
import { protect } from "../middleware/authMiddleware.js";
import {
  createWorkspace,
  getMyWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  joinWorkspace,
  leaveWorkspace,
  removeMember,
  regenerateInviteCode,
} from "../controllers/workspaceController.js";

const router = express.Router();

router.post("/",              protect, createWorkspace);
router.get("/my",             protect, getMyWorkspaces);
router.get("/:id",            protect, getWorkspace);
router.put("/:id",            protect, updateWorkspace);
router.delete("/:id",         protect, deleteWorkspace);
router.post("/join",          protect, joinWorkspace);
router.post("/:id/leave",     protect, leaveWorkspace);
router.delete("/:id/members/:memberId", protect, removeMember);
router.patch("/:id/invite-code", protect, regenerateInviteCode);

export default router;