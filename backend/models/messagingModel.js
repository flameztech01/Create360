import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const messageSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    trim: true,
    default: ''
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file'], // Added 'video'
    default: 'text'
  },
  mediaUrl: {
    type: String,
    default: null
  },
  mediaName: {
    type: String,
    default: null
  },
  mediaSize: {
    type: Number,
    default: null
  },
  mediaDuration: {  // ← ADD THIS for voice notes/video duration
    type: Number,
    default: null
  },
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  deletedAt: {
    type: Date,
    default: null
  },
  edited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    default: null
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes for better query performance
messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ workspace: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });

const Message = mongoose.model('Message', messageSchema);

// ─────────────────────────────────────────────────────────────────────────────
// CHAT SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const chatSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['group', 'direct'],
    required: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  avatar: {
    type: String,
    default: null
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    lastReadAt: {
      type: Date,
      default: Date.now
    },
    online: {  // ← ADD THIS for online status
      type: Boolean,
      default: false
    },
    lastSeen: {  // ← ADD THIS for last seen timestamp
      type: Date,
      default: Date.now
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  typingUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    startedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes
chatSchema.index({ workspace: 1, "participants.user": 1 });
chatSchema.index({ workspace: 1, type: 1 });
chatSchema.index({ lastMessageAt: -1 });

const Chat = mongoose.model('Chat', chatSchema);

// ─────────────────────────────────────────────────────────────────────────────
// TYPING INDICATOR SCHEMA (Temporary storage)
// ─────────────────────────────────────────────────────────────────────────────

const typingIndicatorSchema = new mongoose.Schema({
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startedAt: {
    type: Date,
    default: Date.now,
    expires: 5000 // Auto delete after 5 seconds of inactivity
  }
});

const TypingIndicator = mongoose.model('TypingIndicator', typingIndicatorSchema);

export { Message, Chat, TypingIndicator };