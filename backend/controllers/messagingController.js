import mongoose from "mongoose";
import { Message, Chat, TypingIndicator } from "../models/messagingModel.js";
import Workspace from "../models/workspaceModel.js";
import User from "../models/userModel.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const isWorkspaceMember = async (workspaceId, userId) => {
  const workspace = await Workspace.findById(workspaceId);
  return workspace?.members.some(
    (m) => m.user.toString() === userId && m.status === "active",
  );
};

const isChatParticipant = async (chatId, userId) => {
  const chat = await Chat.findById(chatId);
  return chat?.participants.some((p) => p.user.toString() === userId);
};

const isChatAdmin = async (chatId, userId) => {
  const chat = await Chat.findById(chatId);
  const participant = chat?.participants.find(
    (p) => p.user.toString() === userId,
  );
  return participant?.role === "admin";
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE ONLINE STATUS (NEW)
// POST /api/messages/online-status
// ─────────────────────────────────────────────────────────────────────────────

const updateOnlineStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId, isOnline } = req.body;

    if (!workspaceId) {
      return res.status(400).json({ message: "Workspace ID is required." });
    }

    await Chat.updateMany(
      {
        workspace: workspaceId,
        "participants.user": userId,
      },
      {
        $set: {
          "participants.$.online": isOnline,
          "participants.$.lastSeen": isOnline ? null : new Date(),
        },
      },
    );

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE GROUP CHAT (Owner only)
// POST /api/messages/group
// ─────────────────────────────────────────────────────────────────────────────

const createGroupChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId, name, avatar } = req.body;

    if (!workspaceId || !name?.trim()) {
      return res
        .status(400)
        .json({ message: "Workspace ID and group name are required." });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    if (workspace.owner.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "Only the workspace owner can create group chats." });
    }

    const activeMembers = workspace.members
      .filter((m) => m.status === "active")
      .map((m) => ({
        user: m.user,
        role: m.user.toString() === userId ? "admin" : "member",
        joinedAt: new Date(),
        online: false, // ← ADD THIS
        lastSeen: new Date(), // ← ADD THIS
      }));

    const chat = await Chat.create({
      workspace: workspaceId,
      type: "group",
      name: name.trim(),
      avatar: avatar || null,
      participants: activeMembers,
      createdBy: userId,
      lastMessageAt: new Date(),
    });

    const populatedChat = await Chat.findById(chat._id)
      .populate("participants.user", "name email profile")
      .populate("createdBy", "name email profile");

    res.status(201).json({
      success: true,
      message: "Group chat created successfully",
      chat: populatedChat,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE DIRECT CHAT
// POST /api/messages/direct
// ─────────────────────────────────────────────────────────────────────────────

const createDirectChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId, targetUserId } = req.body;

    if (!workspaceId || !targetUserId) {
      return res
        .status(400)
        .json({ message: "Workspace ID and target user are required." });
    }

    if (targetUserId === userId) {
      return res
        .status(400)
        .json({ message: "Cannot create a chat with yourself." });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    const isUserActive = workspace.members.some(
      (m) => m.user.toString() === userId && m.status === "active",
    );
    const isTargetActive = workspace.members.some(
      (m) => m.user.toString() === targetUserId && m.status === "active",
    );

    if (!isUserActive || !isTargetActive) {
      return res
        .status(403)
        .json({
          message: "Both users must be active members of the workspace.",
        });
    }

    const existingChat = await Chat.findOne({
      workspace: workspaceId,
      type: "direct",
      participants: {
        $all: [{ user: userId }, { user: targetUserId }],
        $size: 2,
      },
    });

    if (existingChat) {
      const populatedChat = await Chat.findById(existingChat._id).populate(
        "participants.user",
        "name email profile",
      );
      return res.status(200).json({
        success: true,
        message: "Chat already exists",
        chat: populatedChat,
      });
    }

    const chat = await Chat.create({
      workspace: workspaceId,
      type: "direct",
      participants: [
        { user: userId, role: "member", online: false, lastSeen: new Date() }, // ← ADDED
        {
          user: targetUserId,
          role: "member",
          online: false,
          lastSeen: new Date(),
        }, // ← ADDED
      ],
      createdBy: userId,
      lastMessageAt: new Date(),
    });

    const populatedChat = await Chat.findById(chat._id).populate(
      "participants.user",
      "name email profile",
    );

    res.status(201).json({
      success: true,
      message: "Direct chat created successfully",
      chat: populatedChat,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET USER CHATS (UPDATED to include online status)
// GET /api/messages/chats
// ─────────────────────────────────────────────────────────────────────────────

const getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId } = req.query;

    if (!workspaceId) {
      return res.status(400).json({ message: "Workspace ID is required." });
    }

    const chats = await Chat.find({
      workspace: workspaceId,
      participants: { $elemMatch: { user: userId } },
      isArchived: false,
    })
      .populate("participants.user", "name email profile")
      .populate("lastMessage")
      .populate("createdBy", "name email profile")
      .sort({ lastMessageAt: -1 });

    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          chat: chat._id,
          readBy: { $not: { $elemMatch: { user: userId } } },
          sender: { $ne: userId },
        });

        // Format participants with online status
        const chatObj = chat.toObject();
        chatObj.participants = chatObj.participants.map((p) => ({
          ...p,
          online: p.online || false,
          lastSeen: p.lastSeen || null,
        }));

        return {
          ...chatObj,
          unreadCount,
        };
      }),
    );

    res.status(200).json({
      success: true,
      chats: chatsWithUnread,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET CHAT MESSAGES
// GET /api/messages/:chatId
// ─────────────────────────────────────────────────────────────────────────────

const getChatMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const isParticipant = await isChatParticipant(chatId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied." });
    }

    const messages = await Message.find({ chat: chatId, isDeleted: false })
      .populate("sender", "name email profile")
      .populate("mentions", "name email profile")
      .populate("replyTo")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    await Message.updateMany(
      {
        chat: chatId,
        sender: { $ne: userId },
        "readBy.user": { $ne: userId },
      },
      {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date(),
          },
        },
      },
    );

    await Chat.updateOne(
      { _id: chatId, "participants.user": userId },
      { $set: { "participants.$.lastReadAt": new Date() } },
    );

    res.status(200).json({
      success: true,
      messages: messages.reverse(),
      count: messages.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SEND MESSAGE (UPDATED to handle file uploads)
// POST /api/messages/:chatId
// ─────────────────────────────────────────────────────────────────────────────

// In your messagingController.js, update the sendMessage function:

const sendMessage = async (req, res) => {
  console.log("=== DEBUG ===");
  console.log("req.file:", req.file);
  console.log("req.body:", req.body);
  console.log("=============");
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const {
      content,
      messageType = "text",
      mentions = [],
      replyToId,
    } = req.body;

    console.log("📨 Send message request:", {
      chatId,
      userId,
      hasFile: !!req.file,
      body: req.body,
      fileInfo: req.file
        ? {
            fieldname: req.file.fieldname,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: req.file.path,
          }
        : null,
    });

    const isParticipant = await isChatParticipant(chatId, userId);
    if (!isParticipant) {
      return res
        .status(403)
        .json({ message: "You are not a participant in this chat." });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found." });
    }

    // Handle uploaded file from multer
    let mediaUrl = null;
    let mediaName = null;
    let mediaSize = null;
    let mediaDuration = null;
    let finalMessageType = messageType;

    if (req.file) {
      console.log("✅ File received successfully");
      mediaUrl = req.file.path;
      mediaName = req.file.originalname;
      mediaSize = req.file.size;
      mediaDuration = req.body.mediaDuration
        ? parseInt(req.body.mediaDuration)
        : null;

      // Determine message type from file mimetype
      if (req.file.mimetype.startsWith("audio/")) {
        finalMessageType = "audio";
      } else if (req.file.mimetype.startsWith("image/")) {
        finalMessageType = "image";
      } else if (req.file.mimetype.startsWith("video/")) {
        finalMessageType = "video";
      } else {
        finalMessageType = "file";
      }
    } else {
      console.log("⚠️ No file in request");
    }

    const validMentions = await Promise.all(
      mentions.map(async (mentionId) => {
        const isValid = chat.participants.some(
          (p) => p.user.toString() === mentionId,
        );
        return isValid ? mentionId : null;
      }),
    );
    const filteredMentions = validMentions.filter((m) => m !== null);

    console.log("📝 Creating message with:", {
      messageType: finalMessageType,
      mediaUrl,
      mediaName,
      mediaSize,
      mediaDuration,
    });

    const message = await Message.create({
      workspace: chat.workspace,
      chat: chatId,
      sender: userId,
      content: content?.trim() || "",
      messageType: finalMessageType,
      mediaUrl: mediaUrl,
      mediaName: mediaName,
      mediaSize: mediaSize,
      mediaDuration: mediaDuration,
      mentions: filteredMentions,
      replyTo: replyToId || null,
      readBy: [{ user: userId, readAt: new Date() }],
    });

    chat.lastMessage = message._id;
    chat.lastMessageAt = new Date();
    await chat.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "name email profile")
      .populate("mentions", "name email profile")
      .populate("replyTo");

    await TypingIndicator.deleteOne({ chat: chatId, user: userId });

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.to(`chat:${chatId}`).emit("new-message", populatedMessage);
    }

    console.log("✅ Message sent successfully:", message._id);

    res.status(201).json({
      success: true,
      message: populatedMessage,
    });
  } catch (error) {
    console.error("❌ Send message error:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE MESSAGE
// DELETE /api/messages/:messageId
// ─────────────────────────────────────────────────────────────────────────────

const deleteMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    const chat = await Chat.findById(message.chat);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found." });
    }

    const isAdmin = await isChatAdmin(message.chat, userId);
    const isSender = message.sender.toString() === userId;

    if (!isAdmin && !isSender) {
      return res
        .status(403)
        .json({
          message: "Only admins or the message sender can delete messages.",
        });
    }

    message.isDeleted = true;
    message.deletedBy = userId;
    message.deletedAt = new Date();
    await message.save();

    res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPING INDICATOR
// POST /api/messages/:chatId/typing
// ─────────────────────────────────────────────────────────────────────────────

const startTyping = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const isParticipant = await isChatParticipant(chatId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied." });
    }

    await TypingIndicator.findOneAndUpdate(
      { chat: chatId, user: userId },
      { startedAt: new Date() },
      { upsert: true },
    );

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const stopTyping = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    await TypingIndicator.deleteOne({ chat: chatId, user: userId });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET TYPING USERS
// GET /api/messages/:chatId/typing
// ─────────────────────────────────────────────────────────────────────────────

const getTypingUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const isParticipant = await isChatParticipant(chatId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied." });
    }

    const typing = await TypingIndicator.find({ chat: chatId })
      .populate("user", "name email profile")
      .where("user")
      .ne(userId);

    res.status(200).json({
      success: true,
      typing: typing.map((t) => t.user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH USERS IN WORKSPACE
// GET /api/messages/search/users
// ─────────────────────────────────────────────────────────────────────────────

const searchUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId, query } = req.query;

    if (!workspaceId) {
      return res.status(400).json({ message: "Workspace ID is required." });
    }

    const workspace = await Workspace.findById(workspaceId).populate(
      "members.user",
      "name email profile",
    );
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    let members = workspace.members
      .filter((m) => m.status === "active" && m.user._id.toString() !== userId)
      .map((m) => m.user);

    if (query) {
      members = members.filter(
        (m) =>
          m.name.toLowerCase().includes(query.toLowerCase()) ||
          m.email.toLowerCase().includes(query.toLowerCase()),
      );
    }

    res.status(200).json({
      success: true,
      users: members,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADD PARTICIPANT TO GROUP
// POST /api/messages/:chatId/participants
// ─────────────────────────────────────────────────────────────────────────────

const addParticipant = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { userIds } = req.body;

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found." });
    }

    if (chat.type !== "group") {
      return res
        .status(400)
        .json({ message: "Only group chats can have participants added." });
    }

    const isAdmin = await isChatAdmin(chatId, userId);
    if (!isAdmin) {
      return res
        .status(403)
        .json({ message: "Only admins can add participants." });
    }

    const workspace = await Workspace.findById(chat.workspace);
    const existingUserIds = chat.participants.map((p) => p.user.toString());

    for (const newUserId of userIds) {
      if (!existingUserIds.includes(newUserId)) {
        const isActiveMember = workspace.members.some(
          (m) => m.user.toString() === newUserId && m.status === "active",
        );
        if (isActiveMember) {
          chat.participants.push({
            user: newUserId,
            role: "member",
            joinedAt: new Date(),
            online: false, // ← ADDED
            lastSeen: new Date(), // ← ADDED
          });
        }
      }
    }

    await chat.save();

    const populatedChat = await Chat.findById(chatId).populate(
      "participants.user",
      "name email profile",
    );

    res.status(200).json({
      success: true,
      message: "Participants added successfully",
      chat: populatedChat,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE PARTICIPANT FROM GROUP
// DELETE /api/messages/:chatId/participants/:userId
// ─────────────────────────────────────────────────────────────────────────────

const removeParticipant = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId, userId: targetUserId } = req.params;

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found." });
    }

    if (chat.type !== "group") {
      return res
        .status(400)
        .json({ message: "Only group chats can have participants removed." });
    }

    const isAdmin = await isChatAdmin(chatId, userId);
    if (!isAdmin) {
      return res
        .status(403)
        .json({ message: "Only admins can remove participants." });
    }

    chat.participants = chat.participants.filter(
      (p) => p.user.toString() !== targetUserId,
    );
    await chat.save();

    res.status(200).json({
      success: true,
      message: "Participant removed successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MARK CHAT AS READ
// POST /api/messages/:chatId/read
// ─────────────────────────────────────────────────────────────────────────────

const markChatAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const isParticipant = await isChatParticipant(chatId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied." });
    }

    await Message.updateMany(
      {
        chat: chatId,
        sender: { $ne: userId },
        "readBy.user": { $ne: userId },
      },
      {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date(),
          },
        },
      },
    );

    await Chat.updateOne(
      { _id: chatId, "participants.user": userId },
      { $set: { "participants.$.lastReadAt": new Date() } },
    );

    res.status(200).json({
      success: true,
      message: "Chat marked as read",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export {
  createGroupChat,
  createDirectChat,
  getUserChats,
  getChatMessages,
  sendMessage,
  deleteMessage,
  startTyping,
  stopTyping,
  getTypingUsers,
  searchUsers,
  addParticipant,
  removeParticipant,
  markChatAsRead,
  updateOnlineStatus, // ← ADD THIS TO EXPORTS
};
