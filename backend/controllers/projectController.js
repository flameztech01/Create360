import Project from '../models/projectModel.js';
import Task from '../models/taskModel.js';
import Workspace from '../models/workspaceModel.js';
import User from '../models/userModel.js';
import { Chat } from '../models/messagingModel.js';
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

const getUserProjectRole = (project, userId) => {
  if (project.projectManagers.some(pm => pm.toString() === userId)) return 'projectManager';
  const member = project.teamMembers.find(tm => tm.user.toString() === userId && tm.status === 'active');
  return member?.role || null;
};

const canManageProject = (workspace, project, userId) => {
  if (isWorkspaceOwner(workspace, userId)) return true;
  if (isProjectManager(project, userId)) return true;
  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE PROJECT (Workspace Owner only)
// POST /api/projects
// ─────────────────────────────────────────────────────────────────────────────

const createProject = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      workspaceId,
      name,
      description,
      startDate,
      endDate,
      priority = 'medium',
      projectManagerIds = [],
      teamMemberIds = []
    } = req.body;

    if (!workspaceId || !name?.trim()) {
      return res.status(400).json({ message: "Workspace ID and project name are required." });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Only workspace owner can create projects
    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only the workspace owner can create projects." });
    }

    // Validate project managers - must be active workspace members
    const validPMs = [];
    for (const pmId of projectManagerIds) {
      const isActive = workspace.members.some(
        m => m.user.toString() === pmId && m.status === 'active'
      );
      if (isActive) validPMs.push(pmId);
    }

    // Validate team members - must be active workspace members
    const validTeamMembers = [];
    for (const memberId of teamMemberIds) {
      const isActive = workspace.members.some(
        m => m.user.toString() === memberId && m.status === 'active'
      );
      if (isActive && !validPMs.includes(memberId)) {
        validTeamMembers.push({
          user: memberId,
          role: 'member',
          status: 'active',
          joinedAt: new Date()
        });
      }
    }

    const project = await Project.create({
      workspace: workspaceId,
      name: name.trim(),
      description: description?.trim() || '',
      createdBy: userId,
      projectManagers: validPMs,
      teamMembers: validTeamMembers,
      startDate: startDate || new Date(),
      endDate: endDate || null,
      priority,
      status: 'planning',
      progress: 0
    });

    // Create group chat for the project team
    const projectChat = await Chat.create({
      workspace: workspaceId,
      type: 'group',
      name: `${name.trim()} - Team Chat`,
      participants: [
        ...validPMs.map(pmId => ({ user: pmId, role: 'admin', joinedAt: new Date() })),
        ...validTeamMembers.map(tm => ({ user: tm.user, role: 'member', joinedAt: new Date() })),
        { user: userId, role: 'admin', joinedAt: new Date() } // Add creator as admin
      ],
      createdBy: userId,
      lastMessageAt: new Date()
    });

    // Update project with chat reference
    project.teamChat = projectChat._id;
    await project.save();

    // Populate and return
    const populatedProject = await Project.findById(project._id)
      .populate('projectManagers', 'name email profile')
      .populate('teamMembers.user', 'name email profile')
      .populate('createdBy', 'name email profile');

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: populatedProject
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET WORKSPACE PROJECTS
// GET /api/projects/workspace/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

const getWorkspaceProjects = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId } = req.params;
    const { status, priority } = req.query;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // Check if user is owner or active member
    const isOwner = isWorkspaceOwner(workspace, userId);
    const isMember = workspace.members.some(
      m => m.user.toString() === userId && m.status === 'active'
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({ message: "Access denied." });
    }

    // Build query
    const query = { workspace: workspaceId };
    if (status) query.status = status;
    if (priority) query.priority = priority;

    // Non-owners only see projects they're managing or part of
    if (!isOwner) {
      query.$or = [
        { projectManagers: userId },
        { 'teamMembers.user': userId, 'teamMembers.status': 'active' }
      ];
    }

    const projects = await Project.find(query)
      .populate('projectManagers', 'name email profile')
      .populate('teamMembers.user', 'name email profile')
      .populate('createdBy', 'name email profile')
      .sort({ createdAt: -1 });

    // Add role info for each project
    const projectsWithRole = projects.map(project => {
      const projObj = project.toObject();
      projObj.userRole = isOwner ? 'workspaceOwner' : getUserProjectRole(project, userId);
      return projObj;
    });

    res.status(200).json({
      success: true,
      projects: projectsWithRole,
      count: projects.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE PROJECT
// GET /api/projects/:projectId
// ─────────────────────────────────────────────────────────────────────────────

const getProjectById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const project = await Project.findById(projectId)
      .populate('projectManagers', 'name email profile')
      .populate('teamMembers.user', 'name email profile')
      .populate('createdBy', 'name email profile');

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

    // Get project stats
    const taskStats = await Task.aggregate([
      { $match: { project: new mongoose.Types.ObjectId(projectId) } },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          inProgressTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] }
          },
          pendingTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    const projectObj = project.toObject();
    projectObj.userRole = isOwner ? 'workspaceOwner' : (isPM ? 'projectManager' : 'teamMember');
    projectObj.taskStats = taskStats[0] || {
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      pendingTasks: 0
    };

    res.status(200).json({
      success: true,
      project: projectObj
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE PROJECT (Owner + Project Managers)
// PUT /api/projects/:projectId
// ─────────────────────────────────────────────────────────────────────────────

const updateProject = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const {
      name,
      description,
      startDate,
      endDate,
      priority,
      status
    } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);
    
    // Only owner or project managers can update
    if (!canManageProject(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can update projects." });
    }

    // Update fields
    if (name) project.name = name.trim();
    if (description !== undefined) project.description = description?.trim() || '';
    if (startDate) project.startDate = startDate;
    if (endDate !== undefined) project.endDate = endDate;
    if (priority) project.priority = priority;
    if (status) project.status = status;

    await project.save();

    const updatedProject = await Project.findById(projectId)
      .populate('projectManagers', 'name email profile')
      .populate('teamMembers.user', 'name email profile')
      .populate('createdBy', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Project updated successfully',
      project: updatedProject
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGN/REMOVE PROJECT MANAGERS (Workspace Owner only)
// PATCH /api/projects/:projectId/managers
// ─────────────────────────────────────────────────────────────────────────────

const manageProjectManagers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const { action, managerId } = req.body;

    if (!action || !managerId) {
      return res.status(400).json({ message: "Action and managerId are required." });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    // Only workspace owner can manage project managers
    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only workspace owner can manage project managers." });
    }

    // Verify user is active workspace member
    const isActiveMember = workspace.members.some(
      m => m.user.toString() === managerId && m.status === 'active'
    );
    if (!isActiveMember) {
      return res.status(400).json({ message: "User must be an active workspace member." });
    }

    if (action === 'add') {
      if (project.projectManagers.includes(managerId)) {
        return res.status(400).json({ message: "User is already a project manager." });
      }
      project.projectManagers.push(managerId);
      
      // Add to project chat as admin if not already there
      await Chat.updateOne(
        { _id: project.teamChat, 'participants.user': { $ne: managerId } },
        { $push: { participants: { user: managerId, role: 'admin', joinedAt: new Date() } } }
      );

    } else if (action === 'remove') {
      // Prevent removing all managers - at least one needed
      if (project.projectManagers.length <= 1) {
        return res.status(400).json({ message: "Project must have at least one project manager." });
      }
      
      project.projectManagers = project.projectManagers.filter(
        pm => pm.toString() !== managerId
      );
      
      // Downgrade to member in chat instead of removing
      await Chat.updateOne(
        { _id: project.teamChat, 'participants.user': managerId },
        { $set: { 'participants.$.role': 'member' } }
      );
    }

    await project.save();

    const updatedProject = await Project.findById(projectId)
      .populate('projectManagers', 'name email profile')
      .populate('teamMembers.user', 'name email profile');

    res.status(200).json({
      success: true,
      message: `Project manager ${action === 'add' ? 'assigned' : 'removed'} successfully`,
      project: updatedProject
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADD TEAM MEMBER TO PROJECT (Owner + Project Managers)
// POST /api/projects/:projectId/team
// ─────────────────────────────────────────────────────────────────────────────

const addTeamMember = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const { memberId, role = 'member' } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    if (!canManageProject(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can add team members." });
    }

    // Check if already in project
    const alreadyMember = project.teamMembers.some(
      tm => tm.user.toString() === memberId && tm.status === 'active'
    );
    if (alreadyMember) {
      return res.status(400).json({ message: "User is already a team member." });
    }

    // Check if user is active workspace member
    const isActiveMember = workspace.members.some(
      m => m.user.toString() === memberId && m.status === 'active'
    );
    if (!isActiveMember) {
      return res.status(400).json({ message: "User must be an active workspace member." });
    }

    // Add to team
    project.teamMembers.push({
      user: memberId,
      role,
      status: 'active',
      joinedAt: new Date()
    });

    await project.save();

    // Add to project chat
    await Chat.updateOne(
      { _id: project.teamChat, 'participants.user': { $ne: memberId } },
      { $push: { participants: { user: memberId, role: 'member', joinedAt: new Date() } } }
    );

    const updatedProject = await Project.findById(projectId)
      .populate('projectManagers', 'name email profile')
      .populate('teamMembers.user', 'name email profile');

    res.status(200).json({
      success: true,
      message: 'Team member added successfully',
      project: updatedProject
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE TEAM MEMBER FROM PROJECT (Owner + Project Managers)
// DELETE /api/projects/:projectId/team/:memberId
// ─────────────────────────────────────────────────────────────────────────────

const removeTeamMember = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId, memberId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    if (!canManageProject(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can remove team members." });
    }

    // Check if user has assigned tasks
    const assignedTasks = await Task.countDocuments({
      project: projectId,
      assignee: memberId,
      status: { $ne: 'completed' }
    });

    if (assignedTasks > 0) {
      return res.status(400).json({ 
        message: `Cannot remove member. They have ${assignedTasks} active tasks. Reassign tasks first.` 
      });
    }

    // Soft delete from project
    const memberIndex = project.teamMembers.findIndex(
      tm => tm.user.toString() === memberId
    );
    if (memberIndex === -1) {
      return res.status(404).json({ message: "Team member not found." });
    }

    project.teamMembers[memberIndex].status = 'removed';
    project.teamMembers[memberIndex].leftAt = new Date();
    await project.save();

    // Remove from project chat
    await Chat.updateOne(
      { _id: project.teamChat },
      { $pull: { participants: { user: memberId } } }
    );

    res.status(200).json({
      success: true,
      message: 'Team member removed successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET PROJECT TEAM WITH TASKS (Owner + Project Managers)
// GET /api/projects/:projectId/team
// ─────────────────────────────────────────────────────────────────────────────

const getProjectTeamWithTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const project = await Project.findById(projectId)
      .populate('projectManagers', 'name email profile')
      .populate('teamMembers.user', 'name email profile');

    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    // Only owner and PMs can see full team with task assignments
    if (!canManageProject(workspace, project, userId)) {
      return res.status(403).json({ message: "Only workspace owner or project managers can view team details." });
    }

    // Get all tasks for this project
    const tasks = await Task.find({ project: projectId })
      .populate('assignee', 'name email profile')
      .sort({ createdAt: -1 });

    // Organize by team member
    const teamWithTasks = project.teamMembers
      .filter(tm => tm.status === 'active')
      .map(tm => {
        const memberTasks = tasks.filter(t => 
          t.assignee?._id.toString() === tm.user._id.toString()
        );
        return {
          member: tm,
          tasks: memberTasks,
          taskStats: {
            total: memberTasks.length,
            completed: memberTasks.filter(t => t.status === 'completed').length,
            inProgress: memberTasks.filter(t => t.status === 'in-progress').length,
            pending: memberTasks.filter(t => t.status === 'pending').length
          }
        };
      });

    // Include project managers (they might have tasks too)
    const pmWithTasks = project.projectManagers.map(pm => {
      const pmTasks = tasks.filter(t => 
        t.assignee?._id.toString() === pm._id.toString()
      );
      return {
        manager: pm,
        isManager: true,
        tasks: pmTasks,
        taskStats: {
          total: pmTasks.length,
          completed: pmTasks.filter(t => t.status === 'completed').length,
          inProgress: pmTasks.filter(t => t.status === 'in-progress').length,
          pending: pmTasks.filter(t => t.status === 'pending').length
        }
      };
    });

    res.status(200).json({
      success: true,
      projectManagers: pmWithTasks,
      teamMembers: teamWithTasks,
      allTasks: tasks
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET DM CHAT LINK FOR TEAM MEMBER
// GET /api/projects/:projectId/dm/:userId
// ─────────────────────────────────────────────────────────────────────────────

const getTeamMemberDM = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId, userId: targetUserId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    // Only owner and PMs can initiate DMs to team members
    if (!canManageProject(workspace, project, userId)) {
      return res.status(403).json({ message: "Access denied." });
    }

    // Check if target is team member
    const isTeamMember = project.teamMembers.some(
      tm => tm.user.toString() === targetUserId && tm.status === 'active'
    ) || project.projectManagers.some(pm => pm.toString() === targetUserId);

    if (!isTeamMember) {
      return res.status(404).json({ message: "User is not part of this project team." });
    }

    // Find or create direct chat
    let chat = await Chat.findOne({
      workspace: project.workspace,
      type: 'direct',
      participants: { 
        $all: [
          { $elemMatch: { user: userId } },
          { $elemMatch: { user: targetUserId } }
        ],
        $size: 2
      }
    });

    if (!chat) {
      chat = await Chat.create({
        workspace: project.workspace,
        type: 'direct',
        participants: [
          { user: userId, role: 'member', joinedAt: new Date() },
          { user: targetUserId, role: 'member', joinedAt: new Date() }
        ],
        createdBy: userId,
        lastMessageAt: new Date()
      });
    }

    res.status(200).json({
      success: true,
      chatId: chat._id,
      chatType: 'direct',
      participant: targetUserId
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE PROJECT (Workspace Owner only)
// DELETE /api/projects/:projectId
// ─────────────────────────────────────────────────────────────────────────────

const deleteProject = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    if (!isWorkspaceOwner(workspace, userId)) {
      return res.status(403).json({ message: "Only workspace owner can delete projects." });
    }

    // Delete all tasks in project
    await Task.deleteMany({ project: projectId });

    // Delete project chat
    if (project.teamChat) {
      await Chat.findByIdAndDelete(project.teamChat);
    }

    // Delete project
    await project.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Project and all associated tasks deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET PROJECT STATISTICS (Owner + Project Managers)
// GET /api/projects/:projectId/stats
// ─────────────────────────────────────────────────────────────────────────────

const getProjectStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const workspace = await Workspace.findById(project.workspace);

    if (!canManageProject(workspace, project, userId)) {
      return res.status(403).json({ message: "Access denied." });
    }

    const stats = await Task.aggregate([
      { $match: { project: new mongoose.Types.ObjectId(projectId) } },
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
          overdueTasks: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $ne: ['$status', 'completed'] },
                    { $lt: ['$dueDate', new Date()] }
                  ]
                }, 
                1, 
                0
              ]
            }
          },
          avgEstimatedHours: { $avg: '$estimatedHours' },
          avgActualHours: { $avg: '$actualHours' }
        }
      }
    ]);

    // Tasks by priority
    const priorityStats = await Task.aggregate([
      { $match: { project: new mongoose.Types.ObjectId(projectId) } },
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

    // Tasks by assignee
    const assigneeStats = await Task.aggregate([
      { $match: { project: new mongoose.Types.ObjectId(projectId), assignee: { $ne: null } } },
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
        overdueTasks: 0,
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

export {
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
};