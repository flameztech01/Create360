// projectRoutes.js
import express from 'express';
import {
  createProject,
  getWorkspaceProjects,
  getProjectById,
  updateProject,
  manageProjectManagers,
  addTeamMember,
  removeTeamMember,
  getProjectTeamWithTasks,
  getTeamMemberDM,
  deleteProject,
  getProjectStats
} from '../controllers/projectController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Project CRUD
router.post('/', protect, createProject);
router.get('/workspace/:workspaceId', protect, getWorkspaceProjects);
router.get('/:projectId', protect, getProjectById);
router.put('/:projectId', protect, updateProject);
router.delete('/:projectId', protect, deleteProject);

// Project Managers management (Owner only)
router.patch('/:projectId/managers', protect, manageProjectManagers);

// Team management (Owner + PMs)
router.post('/:projectId/team', protect, addTeamMember);
router.delete('/:projectId/team/:memberId', protect, removeTeamMember);
router.get('/:projectId/team', protect, getProjectTeamWithTasks);

// DM functionality (Owner + PMs)
router.get('/:projectId/dm/:userId', protect, getTeamMemberDM);

// Statistics (Owner + PMs)
router.get('/:projectId/stats', protect, getProjectStats);

export default router;