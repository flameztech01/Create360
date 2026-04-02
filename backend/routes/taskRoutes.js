// taskRoutes.js
import express from 'express';
import {
  createTask,
  getProjectTasks,
  getTaskById,
  updateTask,
  reassignTask,
  updateTaskStage,
  approveTaskCompletion,
  deleteTask,
  addComment,
  getMyTasks
} from '../controllers/taskController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Personal task view
router.get('/my-tasks', protect, getMyTasks);

// Task CRUD
router.post('/', protect, createTask);
router.get('/project/:projectId', protect, getProjectTasks);
router.get('/:taskId', protect, getTaskById);
router.put('/:taskId', protect, updateTask);
router.delete('/:taskId', protect, deleteTask);

// Task management actions
router.patch('/:taskId/reassign', protect, reassignTask);
router.patch('/:taskId/stage', protect, updateTaskStage);
router.patch('/:taskId/approve', protect, approveTaskCompletion);

// Comments
router.post('/:taskId/comments', protect, addComment);

export default router;