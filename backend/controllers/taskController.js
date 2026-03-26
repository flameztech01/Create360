// taskController.js
import Task from '../models/taskModel.js';
import Workspace from '../models/workspaceModel.js';
import User from '../models/userModel.js';
import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const isWorkspaceOwner = (workspace, userId) => 
  workspace.owner.toString() === userId;

const isWorkspaceMember = (workspace, userId) => 
  workspace.members.some(m => m.user.toString() === userId && m.status === 'active');

const getUserWorkspaceRole = (workspace, userId) => {
  if (workspace.owner.toString() === userId) return 'owner';
  const member = workspace.members.find(m => m.user.toString() === userId && m.status === 'active');
  return member?.role || null;
};

const canManageTask = (workspace, userId, taskAssigneeId = null) => {
  const role = getUserWorkspaceRole(workspace, userId);
  if (role === 'owner') return true;
  if (role === 'Admin' && taskAssigneeId === userId) return true;
  if (taskAssigneeId === userId) return true;
  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE TASK (Owner only)
// POST /api/tasks
// ─────────────────────────────────────────────────────────────────────────────

const createTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      workspaceId,
      title,
      description,
      assigneeId,
      priority = 'medium',
      dueDate,
      stages,
      estimatedHours
    } = req.body;

    if (!workspaceId || !title?.trim()) {
      return res.status(400).json({ message: "Workspace ID and task title are required." });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Only owner can create tasks
    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only the workspace owner can create tasks." });
    }

    // Verify assignee is an active member
    if (assigneeId) {
      const isActiveMember = workspace.members.some(
        m => m.user.toString() === assigneeId && m.status === 'active'
      );
      if (!isActiveMember) {
        return res.status(400).json({ message: "Assignee must be an active member of the workspace." });
      }
    }

    // Create stages if provided, otherwise default
    const taskStages = stages && stages.length > 0 ? stages : [
      {
        name: 'To Do',
        order: 1,
        completed: false,
        completedAt: null
      },
      {
        name: 'In Progress',
        order: 2,
        completed: false,
        completedAt: null
      },
      {
        name: 'Review',
        order: 3,
        completed: false,
        completedAt: null
      },
      {
        name: 'Done',
        order: 4,
        completed: false,
        completedAt: null
      }
    ];

    const task = await Task.create({
      workspace: workspaceId,
      title: title.trim(),
      description: description?.trim() || '',
      assignee: assigneeId || null,
      createdBy: userId,
      priority,
      dueDate: dueDate || null,
      stages: taskStages,
      currentStage: taskStages[0].name,
      estimatedHours: estimatedHours || null,
      actualHours: null,
      status: 'pending',
    });

    // Update workspace active tasks count
    await Workspace.findByIdAndUpdate(workspaceId, {
      $inc: { activeTasks: 1 }
    });

    // Populate assignee and createdBy details
    const populatedTask = await Task.findById(task._id)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile');

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      task: populatedTask
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET WORKSPACE TASKS (Owner + Members)
// GET /api/tasks/workspace/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

const getWorkspaceTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId } = req.params;
    const { status, priority, assigneeId } = req.query;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Check if user is owner or active member
    if (!isWorkspaceOwner(workspace, userId) && !isWorkspaceMember(workspace, userId)) {
      return res.status(403).json({ message: "Access denied. You are not a member of this workspace." });
    }

    // Build query
    const query = { workspace: workspaceId };
    
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (assigneeId) query.assignee = assigneeId;

    // Non-owners can only see tasks assigned to them
    if (!isWorkspaceOwner(workspace, userId)) {
      query.$or = [
        { assignee: userId },
        { createdBy: userId }
      ];
    }

    const tasks = await Task.find(query)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      tasks,
      count: tasks.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE TASK
// GET /api/tasks/:taskId
// ─────────────────────────────────────────────────────────────────────────────

const getTaskById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile')
      .populate('completedBy', 'name email profile');

    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const workspace = await Workspace.findById(task.workspace);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Check access
    if (!isWorkspaceOwner(workspace, userId) && 
        !isWorkspaceMember(workspace, userId) &&
        task.createdBy.toString() !== userId &&
        task.assignee?.toString() !== userId) {
      return res.status(403).json({ message: "Access denied." });
    }

    res.status(200).json({
      success: true,
      task
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TASK (Owner only)
// PUT /api/tasks/:taskId
// ─────────────────────────────────────────────────────────────────────────────

const updateTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const {
      title,
      description,
      assigneeId,
      priority,
      dueDate,
      estimatedHours,
      status
    } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const workspace = await Workspace.findById(task.workspace);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Only owner can update tasks
    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only the workspace owner can update tasks." });
    }

    // Update fields
    if (title) task.title = title.trim();
    if (description !== undefined) task.description = description?.trim() || '';
    if (priority) task.priority = priority;
    if (dueDate !== undefined) task.dueDate = dueDate;
    if (estimatedHours !== undefined) task.estimatedHours = estimatedHours;
    if (status) task.status = status;

    // Update assignee if changed
    if (assigneeId && assigneeId !== task.assignee?.toString()) {
      // Verify new assignee is active member
      const isActiveMember = workspace.members.some(
        m => m.user.toString() === assigneeId && m.status === 'active'
      );
      if (!isActiveMember) {
        return res.status(400).json({ message: "Assignee must be an active member of the workspace." });
      }
      task.assignee = assigneeId;
    }

    await task.save();

    const updatedTask = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Task updated successfully',
      task: updatedTask
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TASK STAGE (Assignee or Owner)
// PATCH /api/tasks/:taskId/stage
// ─────────────────────────────────────────────────────────────────────────────

const updateTaskStage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { stageName, notes } = req.body;

    if (!stageName) {
      return res.status(400).json({ message: "Stage name is required." });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const workspace = await Workspace.findById(task.workspace);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Check if user can update stage (assignee or owner)
    const isOwner = isWorkspaceOwner(workspace, userId);
    const isAssignee = task.assignee?.toString() === userId;

    if (!isOwner && !isAssignee) {
      return res.status(403).json({ message: "Only the assignee or workspace owner can update task stages." });
    }

    // Find stage index
    const stageIndex = task.stages.findIndex(s => s.name === stageName);
    if (stageIndex === -1) {
      return res.status(400).json({ message: "Invalid stage name." });
    }

    // If marking a stage as complete, check sequential order
    const currentStageIndex = task.stages.findIndex(s => s.name === task.currentStage);
    
    if (!task.stages[stageIndex].completed) {
      // Check if previous stages are completed
      for (let i = 0; i < stageIndex; i++) {
        if (!task.stages[i].completed) {
          return res.status(400).json({ 
            message: `Cannot complete "${stageName}". Complete "${task.stages[i].name}" first.` 
          });
        }
      }
      
      // Mark this stage as completed
      task.stages[stageIndex].completed = true;
      task.stages[stageIndex].completedAt = new Date();
      task.stages[stageIndex].completedBy = userId;
      
      // Add notes if provided
      if (notes) {
        task.stages[stageIndex].notes = notes;
      }
      
      // Update current stage to next incomplete stage or stay if last
      const nextIncompleteIndex = task.stages.findIndex((s, idx) => idx > stageIndex && !s.completed);
      if (nextIncompleteIndex !== -1) {
        task.currentStage = task.stages[nextIncompleteIndex].name;
      } else {
        task.currentStage = stageName;
        // If all stages completed, mark task as completed
        const allCompleted = task.stages.every(s => s.completed);
        if (allCompleted) {
          task.status = 'completed';
          task.completedAt = new Date();
          task.completedBy = userId;
          task.actualHours = task.actualHours || 0;
        }
      }
    }

    await task.save();

    const updatedTask = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile')
      .populate('stages.completedBy', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Task stage updated successfully',
      task: updatedTask
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE TASK (Owner only - final approval)
// PATCH /api/tasks/:taskId/complete
// ─────────────────────────────────────────────────────────────────────────────

const completeTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { actualHours, feedback } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const workspace = await Workspace.findById(task.workspace);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Only owner can mark task as complete
    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only the workspace owner can mark tasks as complete." });
    }

    // Check if all stages are completed
    const allStagesCompleted = task.stages.every(s => s.completed);
    if (!allStagesCompleted) {
      return res.status(400).json({ 
        message: "Cannot complete task. Not all stages are completed.",
        incompleteStages: task.stages.filter(s => !s.completed).map(s => s.name)
      });
    }

    task.status = 'completed';
    task.completedAt = new Date();
    task.completedBy = userId;
    
    if (actualHours) task.actualHours = actualHours;
    if (feedback) task.feedback = feedback.trim();

    await task.save();

    // Update workspace active tasks count
    await Workspace.findByIdAndUpdate(task.workspace, {
      $inc: { activeTasks: -1 }
    });

    const completedTask = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile')
      .populate('completedBy', 'name email profile')
      .populate('stages.completedBy', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Task completed successfully',
      task: completedTask
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE TASK (Owner only)
// DELETE /api/tasks/:taskId
// ─────────────────────────────────────────────────────────────────────────────

const deleteTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const workspace = await Workspace.findById(task.workspace);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Only owner can delete tasks
    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only the workspace owner can delete tasks." });
    }

    // If task wasn't completed, decrement active tasks count
    if (task.status !== 'completed') {
      await Workspace.findByIdAndUpdate(task.workspace, {
        $inc: { activeTasks: -1 }
      });
    }

    await task.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET TASK STATISTICS (Owner only)
// GET /api/tasks/workspace/:workspaceId/stats
// ─────────────────────────────────────────────────────────────────────────────

const getTaskStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId } = req.params;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only the workspace owner can view task statistics." });
    }

    const stats = await Task.aggregate([
      { $match: { workspace: new mongoose.Types.ObjectId(workspaceId) } },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          inProgressTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] }
          },
          avgEstimatedHours: { $avg: '$estimatedHours' },
          avgActualHours: { $avg: '$actualHours' }
        }
      }
    ]);

    // Get tasks by priority
    const priorityStats = await Task.aggregate([
      { $match: { workspace: new mongoose.Types.ObjectId(workspaceId) } },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      }
    ]);

    // Get tasks by assignee
    const assigneeStats = await Task.aggregate([
      { $match: { workspace: new mongoose.Types.ObjectId(workspaceId), assignee: { $ne: null } } },
      {
        $group: {
          _id: '$assignee',
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      },
      { $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'assigneeInfo'
        }
      },
      { $unwind: '$assigneeInfo' },
      { $project: {
          assignee: { name: '$assigneeInfo.name', email: '$assigneeInfo.email' },
          totalTasks: 1,
          completedTasks: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      stats: stats[0] || {
        totalTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        avgEstimatedHours: 0,
        avgActualHours: 0
      },
      priorityStats,
      assigneeStats
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADD TASK COMMENT (Owner + Assignee)
// POST /api/tasks/:taskId/comments
// ─────────────────────────────────────────────────────────────────────────────

const addComment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { comment } = req.body;

    if (!comment?.trim()) {
      return res.status(400).json({ message: "Comment is required." });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const workspace = await Workspace.findById(task.workspace);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Check access
    if (!isWorkspaceOwner(workspace, userId) && 
        !isWorkspaceMember(workspace, userId) &&
        task.assignee?.toString() !== userId &&
        task.createdBy?.toString() !== userId) {
      return res.status(403).json({ message: "Access denied." });
    }

    task.comments.push({
      user: userId,
      comment: comment.trim(),
      createdAt: new Date()
    });

    await task.save();

    const updatedTask = await Task.findById(taskId)
      .populate('comments.user', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Comment added successfully',
      comments: updatedTask.comments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

export {
  createTask,
  getWorkspaceTasks,
  getTaskById,
  updateTask,
  updateTaskStage,
  completeTask,
  deleteTask,
  getTaskStats,
  addComment
};