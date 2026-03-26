// teamRoutes.js
import express from "express";
import {
  requestToJoin,
  getPendingRequests,
  approveMember,
  rejectMember,
  getMembers,
  getMembersByDepartment,
  updateMember,
  removeMember,
  getMyMembership,
} from "../controllers/teamController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Staff actions
router.post("/join", protect, requestToJoin);
router.get("/:workspaceId/me", protect, getMyMembership);

// Owner actions
router.get("/:workspaceId/requests", protect, getPendingRequests);
router.put("/:workspaceId/approve/:memberId", protect, approveMember);
router.delete("/:workspaceId/reject/:memberId", protect, rejectMember);
router.delete("/:workspaceId/member/:memberId", protect, removeMember);
router.put("/:workspaceId/member/:memberId", protect, updateMember);

// Shared (owner + active members)
router.get("/:workspaceId/members", protect, getMembers);
router.get("/:workspaceId/department/:department", protect, getMembersByDepartment);

export default router;