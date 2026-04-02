// projectModel.js
import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Multiple project managers supported
  projectManagers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Team members with roles
  teamMembers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['lead', 'senior', 'member', 'junior'],
      default: 'member'
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'removed'],
      default: 'active'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: {
      type: Date,
      default: null
    }
  }],
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    default: null
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['planning', 'in-progress', 'on-hold', 'completed', 'cancelled'],
    default: 'planning'
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  teamChat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    default: null
  },
  tags: [{
    type: String,
    trim: true
  }],
  attachments: [{
    name: String,
    url: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes for performance
projectSchema.index({ workspace: 1, status: 1 });
projectSchema.index({ projectManagers: 1 });
projectSchema.index({ 'teamMembers.user': 1 });

const Project = mongoose.model('Project', projectSchema);
export default Project;