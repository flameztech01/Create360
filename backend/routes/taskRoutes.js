// taskRoutes.js
import express from 'express';
import {
  createTask,
  getWorkspaceTasks,
  getTaskById,
  updateTask,
  updateTaskStage,
  completeTask,
  deleteTask,
  getTaskStats,
  addComment
} from '../controllers/taskController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Task routes
router.route('/')
  .post(protect, createTask);

router.get('/workspace/:workspaceId', protect, getWorkspaceTasks);
router.get('/workspace/:workspaceId/stats', protect, getTaskStats);
router.get('/:taskId', protect, getTaskById);

router.route('/:taskId')
  .put(protect, updateTask)
  .delete(protect, deleteTask);

router.patch('/:taskId/stage', protect, updateTaskStage);
router.patch('/:taskId/complete', protect, completeTask);
router.post('/:taskId/comments', protect, addComment);

export default router;