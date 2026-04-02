// taskController.js
import Task from '../models/taskModel.js';
import Project from '../models/projectModel.js';
import Workspace from '../models/workspaceModel.js';
import User from '../models/userModel.js';
import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const isWorkspaceOwner = (workspace, userId) => 
  workspace.owner.toString() === userId;

const isProjectManager = (project, userId) => 
  project.projectManagers.some(pm => pm.toString() === userId);

const isProjectMember = (project, userId) => 
  project.teamMembers.some(tm => tm.user.toString() === userId && tm.status === 'active');

const canManageTasks = (workspace, project, userId) => {
  if (isWorkspaceOwner(workspace, userId)) return true;
  if (isProjectManager(project, userId)) return true;
  return false;
};

const canViewTask = (workspace, project, userId, task) => {
  if (isWorkspaceOwner(workspace, userId)) return true;
  if (isProjectManager(project, userId)) return true;
  if (task.assignee?.toString() === userId) return true;
  if (task.createdBy?.toString() === userId) return true;
  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE TASK (Owner + Project Managers)
// POST /api/tasks
// ─────────────────────────────────────────────────────────────────────────────

const createTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      projectId,
      title,
      description,
      assigneeId,
      priority = 'medium',
      dueDate,
      stages,
      estimatedHours,
      dependencies = [] // Task dependencies
    } = req.body;

    if (!projectId || !title?.trim()) {
      return res.status(400).json({ message: "Project ID and task title are required." });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Only owner or project managers can create tasks
    if (!canManageTasks(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can create tasks." });
    }

    // Verify assignee is active project member (or manager)
    if (assigneeId) {
      const isValidAssignee = project.teamMembers.some(
        tm => tm.user.toString() === assigneeId && tm.status === 'active'
      ) || project.projectManagers.some(pm => pm.toString() === assigneeId);
      
      if (!isValidAssignee) {
        return res.status(400).json({ message: "Assignee must be an active project team member or manager." });
      }
    }

    // Create default stages if not provided
    const taskStages = stages && stages.length > 0 ? stages : [
      { name: 'To Do', order: 1, completed: false, completedAt: null },
      { name: 'In Progress', order: 2, completed: false, completedAt: null },
      { name: 'Review', order: 3, completed: false, completedAt: null },
      { name: 'Done', order: 4, completed: false, completedAt: null }
    ];

    const task = await Task.create({
      project: projectId,
      workspace: project.workspace,
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
      dependencies: dependencies.map(dep => new mongoose.Types.ObjectId(dep))
    });

    // Update project task count and progress
    await updateProjectProgress(projectId);

    // Populate and return
    const populatedTask = await Task.findById(task._id)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile')
      .populate('dependencies', 'title status');

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
// GET PROJECT TASKS
// GET /api/tasks/project/:projectId
// ─────────────────────────────────────────────────────────────────────────────

const getProjectTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const { status, priority, assigneeId, view } = req.query;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    // Check access
    const isOwner = isWorkspaceOwner(workspace, userId);
    const isPM = isProjectManager(project, userId);
    const isMember = isProjectMember(project, userId);

    if (!isOwner && !isPM && !isMember) {
      return res.status(403).json({ message: "Access denied." });
    }

    // Build query
    const query = { project: projectId };
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (assigneeId) query.assignee = assigneeId;

    // Non-managers only see their assigned tasks
    if (!isOwner && !isPM) {
      query.$or = [
        { assignee: userId },
        { createdBy: userId }
      ];
    }

    const tasks = await Task.find(query)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile')
      .populate('dependencies', 'title status')
      .sort({ createdAt: -1 });

    // Group by status for board view
    let response = { tasks, count: tasks.length };
    
    if (view === 'board') {
      const boardColumns = {
        pending: tasks.filter(t => t.status === 'pending'),
        'in-progress': tasks.filter(t => t.status === 'in-progress'),
        review: tasks.filter(t => t.currentStage === 'Review' && t.status !== 'completed'),
        completed: tasks.filter(t => t.status === 'completed')
      };
      response = { board: boardColumns, count: tasks.length };
    }

    res.status(200).json({
      success: true,
      ...response,
      userRole: isOwner ? 'workspaceOwner' : (isPM ? 'projectManager' : 'teamMember')
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
      .populate('completedBy', 'name email profile')
      .populate('dependencies', 'title status currentStage')
      .populate('project', 'name projectManagers teamMembers');

    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const project = await Project.findById(task.project);
    const workspace = await Workspace.findById(project.workspace);

    if (!canViewTask(workspace, project, userId, task)) {
      return res.status(403).json({ message: "Access denied." });
    }

    // Get dependent tasks (tasks that depend on this one)
    const dependentTasks = await Task.find({ dependencies: taskId })
      .populate('assignee', 'name email')
      .select('title status assignee');

    const taskObj = task.toObject();
    taskObj.dependentTasks = dependentTasks;
    taskObj.userRole = isWorkspaceOwner(workspace, userId) ? 'workspaceOwner' : 
                       (isProjectManager(project, userId) ? 'projectManager' : 'teamMember');
    taskObj.canManage = canManageTasks(workspace, project, userId);

    res.status(200).json({
      success: true,
      task: taskObj
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TASK (Owner + Project Managers)
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
      status,
      dependencies
    } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const project = await Project.findById(task.project);
    const workspace = await Workspace.findById(project.workspace);

    // Only owner or project managers can update tasks
    if (!canManageTasks(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can update tasks." });
    }

    // Update fields
    if (title) task.title = title.trim();
    if (description !== undefined) task.description = description?.trim() || '';
    if (priority) task.priority = priority;
    if (dueDate !== undefined) task.dueDate = dueDate;
    if (estimatedHours !== undefined) task.estimatedHours = estimatedHours;
    if (status) task.status = status;
    if (dependencies) task.dependencies = dependencies.map(dep => new mongoose.Types.ObjectId(dep));

    // Update assignee
    if (assigneeId !== undefined && assigneeId !== task.assignee?.toString()) {
      if (assigneeId === null) {
        task.assignee = null;
      } else {
        // Verify new assignee is project member
        const isValid = project.teamMembers.some(
          tm => tm.user.toString() === assigneeId && tm.status === 'active'
        ) || project.projectManagers.some(pm => pm.toString() === assigneeId);
        
        if (!isValid) {
          return res.status(400).json({ message: "Assignee must be an active project member." });
        }
        task.assignee = assigneeId;
      }
    }

    await task.save();
    await updateProjectProgress(task.project);

    const updatedTask = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('createdBy', 'name email profile')
      .populate('dependencies', 'title status');

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
// REASSIGN TASK (Owner + Project Managers) - Quick reassignment endpoint
// PATCH /api/tasks/:taskId/reassign
// ─────────────────────────────────────────────────────────────────────────────

const reassignTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { assigneeId, reason } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const project = await Project.findById(task.project);
    const workspace = await Workspace.findById(project.workspace);

    if (!canManageTasks(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can reassign tasks." });
    }

    const previousAssignee = task.assignee;

    // Validate new assignee
    if (assigneeId) {
      const isValid = project.teamMembers.some(
        tm => tm.user.toString() === assigneeId && tm.status === 'active'
      ) || project.projectManagers.some(pm => pm.toString() === assigneeId);
      
      if (!isValid) {
        return res.status(400).json({ message: "New assignee must be an active project member." });
      }
    }

    task.assignee = assigneeId || null;
    task.reassignmentHistory = task.reassignmentHistory || [];
    task.reassignmentHistory.push({
      from: previousAssignee,
      to: assigneeId,
      reassignedBy: userId,
      reason: reason || 'Task reassigned',
      reassignedAt: new Date()
    });

    await task.save();

    const updatedTask = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('reassignmentHistory.reassignedBy', 'name email');

    res.status(200).json({
      success: true,
      message: `Task reassigned successfully`,
      task: updatedTask
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TASK STAGE (Assignee, Project Managers, or Owner)
// PATCH /api/tasks/:taskId/stage
// ─────────────────────────────────────────────────────────────────────────────

const updateTaskStage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { stageName, notes, actualHours } = req.body;

    if (!stageName) {
      return res.status(400).json({ message: "Stage name is required." });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const project = await Project.findById(task.project);
    const workspace = await Workspace.findById(project.workspace);

    // Check permissions
    const isOwner = isWorkspaceOwner(workspace, userId);
    const isPM = isProjectManager(project, userId);
    const isAssignee = task.assignee?.toString() === userId;

    if (!isOwner && !isPM && !isAssignee) {
      return res.status(403).json({ message: "Only assignee, project managers, or workspace owner can update stages." });
    }

    // Find stage
    const stageIndex = task.stages.findIndex(s => s.name === stageName);
    if (stageIndex === -1) {
      return res.status(400).json({ message: "Invalid stage name." });
    }

    // Check dependencies if trying to start
    if (stageName === 'In Progress' && !task.stages[stageIndex].completed) {
      const blockingDeps = await Task.find({
        _id: { $in: task.dependencies },
        status: { $ne: 'completed' }
      });
      
      if (blockingDeps.length > 0) {
        return res.status(400).json({
          message: "Cannot start task. Dependencies not completed.",
          blockingDependencies: blockingDeps.map(d => ({ id: d._id, title: d.title }))
        });
      }
    }

    // Mark stage complete
    if (!task.stages[stageIndex].completed) {
      // Check sequential completion
      for (let i = 0; i < stageIndex; i++) {
        if (!task.stages[i].completed) {
          return res.status(400).json({ 
            message: `Complete "${task.stages[i].name}" first.` 
          });
        }
      }
      
      task.stages[stageIndex].completed = true;
      task.stages[stageIndex].completedAt = new Date();
      task.stages[stageIndex].completedBy = userId;
      if (notes) task.stages[stageIndex].notes = notes;
      
      // Move to next stage or complete
      const nextIncomplete = task.stages.findIndex((s, idx) => idx > stageIndex && !s.completed);
      if (nextIncomplete !== -1) {
        task.currentStage = task.stages[nextIncomplete].name;
      } else {
        task.currentStage = stageName;
        const allDone = task.stages.every(s => s.completed);
        if (allDone) {
          task.status = 'review'; // Ready for PM review, not fully completed
        }
      }
    }

    if (actualHours) task.actualHours = actualHours;

    await task.save();
    await updateProjectProgress(task.project);

    const updatedTask = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('stages.completedBy', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Task stage updated',
      task: updatedTask
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// APPROVE TASK COMPLETION (Owner + Project Managers only)
// PATCH /api/tasks/:taskId/approve
// ─────────────────────────────────────────────────────────────────────────────

const approveTaskCompletion = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { feedback, finalHours } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const project = await Project.findById(task.project);
    const workspace = await Workspace.findById(project.workspace);

    if (!canManageTasks(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can approve task completion." });
    }

    // Verify all stages done
    const allStagesDone = task.stages.every(s => s.completed);
    if (!allStagesDone) {
      return res.status(400).json({ 
        message: "Cannot approve. Not all stages completed.",
        incompleteStages: task.stages.filter(s => !s.completed).map(s => s.name)
      });
    }

    task.status = 'completed';
    task.completedAt = new Date();
    task.completedBy = userId;
    task.approvedBy = userId;
    if (finalHours) task.actualHours = finalHours;
    if (feedback) task.completionFeedback = feedback;

    await task.save();
    await updateProjectProgress(task.project);

    const completedTask = await Task.findById(taskId)
      .populate('assignee', 'name email profile')
      .populate('completedBy', 'name email profile')
      .populate('approvedBy', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Task approved and completed',
      task: completedTask
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE TASK (Owner + Project Managers)
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

    const project = await Project.findById(task.project);
    const workspace = await Workspace.findById(project.workspace);

    if (!canManageTasks(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can delete tasks." });
    }

    const projectId = task.project;
    await task.deleteOne();
    await updateProjectProgress(projectId);

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Update project progress based on completed tasks
// ─────────────────────────────────────────────────────────────────────────────

const updateProjectProgress = async (projectId) => {
  const stats = await Task.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(projectId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        }
      }
    }
  ]);

  if (stats.length > 0) {
    const progress = Math.round((stats[0].completed / stats[0].total) * 100);
    await Project.findByIdAndUpdate(projectId, { 
      progress,
      $set: { 
        status: progress === 100 ? 'completed' : progress > 0 ? 'in-progress' : 'planning'
      }
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADD TASK COMMENT (Owner, PMs, Assignee)
// POST /api/tasks/:taskId/comments
// ─────────────────────────────────────────────────────────────────────────────

const addComment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { comment, mentions = [] } = req.body;

    if (!comment?.trim()) {
      return res.status(400).json({ message: "Comment is required." });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const project = await Project.findById(task.project);
    const workspace = await Workspace.findById(project.workspace);

    // Check access
    const isOwner = isWorkspaceOwner(workspace, userId);
    const isPM = isProjectManager(project, userId);
    const isAssignee = task.assignee?.toString() === userId;
    const isMember = isProjectMember(project, userId);

    if (!isOwner && !isPM && !isAssignee && !isMember) {
      return res.status(403).json({ message: "Access denied." });
    }

    // Filter valid mentions to project members only
    const validMentions = mentions.filter(m => 
      project.teamMembers.some(tm => tm.user.toString() === m && tm.status === 'active') ||
      project.projectManagers.some(pm => pm.toString() === m)
    );

    task.comments.push({
      user: userId,
      comment: comment.trim(),
      mentions: validMentions,
      createdAt: new Date()
    });

    await task.save();

    const updatedTask = await Task.findById(taskId)
      .populate('comments.user', 'name email profile')
      .populate('comments.mentions', 'name email');

    res.status(200).json({
      success: true,
      message: 'Comment added',
      comments: updatedTask.comments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET USER'S TASKS ACROSS PROJECTS
// GET /api/tasks/my-tasks
// ─────────────────────────────────────────────────────────────────────────────

const getMyTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, priority, workspaceId } = req.query;

    const query = { assignee: userId };
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (workspaceId) query.workspace = workspaceId;

    const tasks = await Task.find(query)
      .populate('project', 'name status')
      .populate('workspace', 'name')
      .sort({ dueDate: 1, priority: -1 });

    // Group by project
    const groupedByProject = tasks.reduce((acc, task) => {
      const projId = task.project._id.toString();
      if (!acc[projId]) {
        acc[projId] = {
          project: task.project,
          workspace: task.workspace,
          tasks: []
        };
      }
      acc[projId].tasks.push(task);
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      tasks: tasks,
      groupedByProject: Object.values(groupedByProject),
      stats: {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        pending: tasks.filter(t => t.status === 'pending').length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        overdue: tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed').length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

export {
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
};