// socket.js
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Message, Chat, TypingIndicator } from '../models/messagingModel.js';
import User from '../models/userModel.js';

let io;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      console.log('Socket auth - Token received:', token ? 'Yes' : 'No');
      
      if (!token) {
        console.log('No token provided');
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded:', decoded);
      
      // Handle both possible property names (userId or id)
      const userId = decoded.userId || decoded.id || decoded.sub;
      
      if (!userId) {
        console.log('No user ID found in token');
        return next(new Error('No user ID in token'));
      }
      
      console.log('Looking for user with ID:', userId);
      
      const user = await User.findById(userId).select('-password');
      
      if (!user) {
        console.log('User not found for ID:', userId);
        return next(new Error('User not found'));
      }

      socket.user = user;
      socket.userId = user._id.toString();
      console.log('✅ Socket authenticated for user:', user.name);
      next();
    } catch (err) {
      console.error('Socket auth error:', err.message);
      next(new Error('Authentication error: ' + err.message));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`✅ User connected: ${socket.userId} - ${socket.user.name}`);

    // Join user to their personal room
    socket.join(`user:${socket.userId}`);

    // ─────────────────────────────────────────────────────────────────────────
    // ONLINE STATUS HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    const updateUserOnlineStatus = async (isOnline) => {
      try {
        // Update all chats where user is a participant
        await Chat.updateMany(
          {
            'participants.user': socket.userId
          },
          {
            $set: {
              'participants.$.online': isOnline,
              'participants.$.lastSeen': isOnline ? null : new Date()
            }
          }
        );

        // Get all chats to notify participants
        const chats = await Chat.find({ 'participants.user': socket.userId });
        
        for (const chat of chats) {
          // Notify all participants in each chat
          io.to(`chat:${chat._id}`).emit('user-status-changed', {
            userId: socket.userId,
            online: isOnline,
            lastSeen: isOnline ? null : new Date(),
            chatId: chat._id
          });
        }

        console.log(`📡 User ${socket.user.name} is now ${isOnline ? 'online' : 'offline'}`);
      } catch (error) {
        console.error('Error updating online status:', error);
      }
    };

    // Set user as online on connection
    await updateUserOnlineStatus(true);

    // Handle presence updates from client
    socket.on('presence', async (data) => {
      const { status } = data;
      const isOnline = status === 'online';
      await updateUserOnlineStatus(isOnline);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // WORKSPACE & CHAT ROOMS
    // ─────────────────────────────────────────────────────────────────────────

    // Join workspace rooms
    socket.on('join-workspace', (workspaceId) => {
      socket.join(`workspace:${workspaceId}`);
      console.log(`📢 User ${socket.user.name} joined workspace: ${workspaceId}`);
    });

    // Join chat room
    socket.on('join-chat', (chatId) => {
      socket.join(`chat:${chatId}`);
      console.log(`💬 User ${socket.user.name} joined chat: ${chatId}`);
    });

    // Leave chat room
    socket.on('leave-chat', (chatId) => {
      socket.leave(`chat:${chatId}`);
      console.log(`👋 User ${socket.user.name} left chat: ${chatId}`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SEND MESSAGE
    // ─────────────────────────────────────────────────────────────────────────

    socket.on('send-message', async (data, callback) => {
      try {
        const { 
          chatId, 
          content, 
          messageType, 
          mentions, 
          replyToId, 
          mediaUrl, 
          mediaName, 
          mediaSize,
          mediaDuration
        } = data;

        const chat = await Chat.findById(chatId);
        if (!chat) {
          return callback({ error: 'Chat not found' });
        }

        // Check if user is participant
        const isParticipant = chat.participants.some(p => p.user.toString() === socket.userId);
        if (!isParticipant) {
          return callback({ error: 'You are not a participant in this chat' });
        }

        // Create message with mediaDuration
        const message = await Message.create({
          workspace: chat.workspace,
          chat: chatId,
          sender: socket.userId,
          content: content?.trim() || '',
          messageType: messageType || 'text',
          mediaUrl: mediaUrl || null,
          mediaName: mediaName || null,
          mediaSize: mediaSize || null,
          mediaDuration: mediaDuration || null,
          mentions: mentions || [],
          replyTo: replyToId || null,
          readBy: [{ user: socket.userId, readAt: new Date() }]
        });

        // Update chat's last message
        chat.lastMessage = message._id;
        chat.lastMessageAt = new Date();
        await chat.save();

        // Populate message data
        const populatedMessage = await Message.findById(message._id)
          .populate('sender', 'name email profile')
          .populate('mentions', 'name email profile')
          .populate('replyTo');

        // Emit to all participants in the chat room
        io.to(`chat:${chatId}`).emit('new-message', populatedMessage);

        // Emit to each participant individually for notification
        for (const participant of chat.participants) {
          if (participant.user.toString() !== socket.userId) {
            io.to(`user:${participant.user}`).emit('message-notification', {
              chatId,
              message: populatedMessage,
              workspaceId: chat.workspace
            });
          }
        }

        // Clear typing indicator for this user
        await TypingIndicator.deleteOne({ chat: chatId, user: socket.userId });
        io.to(`chat:${chatId}`).emit('user-stopped-typing', {
          chatId,
          userId: socket.userId
        });

        callback({ success: true, message: populatedMessage });
      } catch (error) {
        console.error('Error sending message:', error);
        callback({ error: error.message });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TYPING INDICATOR
    // ─────────────────────────────────────────────────────────────────────────

    socket.on('start-typing', async (data) => {
      try {
        const { chatId } = data;
        
        const chat = await Chat.findById(chatId);
        if (!chat) return;

        const isParticipant = chat.participants.some(p => p.user.toString() === socket.userId);
        if (!isParticipant) return;

        // Update or create typing indicator
        await TypingIndicator.findOneAndUpdate(
          { chat: chatId, user: socket.userId },
          { startedAt: new Date() },
          { upsert: true }
        );

        // Notify other participants
        socket.to(`chat:${chatId}`).emit('user-typing', {
          chatId,
          user: {
            _id: socket.userId,
            name: socket.user.name,
            email: socket.user.email,
            profile: socket.user.profile
          }
        });
      } catch (error) {
        console.error('Error handling typing:', error);
      }
    });

    socket.on('stop-typing', async (data) => {
      try {
        const { chatId } = data;
        
        await TypingIndicator.deleteOne({ chat: chatId, user: socket.userId });
        
        socket.to(`chat:${chatId}`).emit('user-stopped-typing', {
          chatId,
          userId: socket.userId
        });
      } catch (error) {
        console.error('Error stopping typing:', error);
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // MARK MESSAGES AS READ
    // ─────────────────────────────────────────────────────────────────────────

    socket.on('mark-read', async (data) => {
      try {
        const { chatId, messageIds } = data;
        
        const chat = await Chat.findById(chatId);
        if (!chat) return;

        const isParticipant = chat.participants.some(p => p.user.toString() === socket.userId);
        if (!isParticipant) return;

        // Mark messages as read
        await Message.updateMany(
          {
            _id: { $in: messageIds },
            'readBy.user': { $ne: socket.userId }
          },
          {
            $push: {
              readBy: {
                user: socket.userId,
                readAt: new Date()
              }
            }
          }
        );

        // Update user's last read time in chat
        await Chat.updateOne(
          { _id: chatId, 'participants.user': socket.userId },
          { $set: { 'participants.$.lastReadAt': new Date() } }
        );

        // Notify sender that messages were read
        const messages = await Message.find({ _id: { $in: messageIds } });
        for (const message of messages) {
          if (message.sender.toString() !== socket.userId) {
            io.to(`user:${message.sender}`).emit('message-read', {
              chatId,
              messageId: message._id,
              readBy: socket.userId
            });
          }
        }
      } catch (error) {
        console.error('Error marking read:', error);
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // DELETE MESSAGE
    // ─────────────────────────────────────────────────────────────────────────

    socket.on('delete-message', async (data, callback) => {
      try {
        const { messageId } = data;
        
        const message = await Message.findById(messageId);
        if (!message) {
          return callback({ error: 'Message not found' });
        }

        const chat = await Chat.findById(message.chat);
        if (!chat) {
          return callback({ error: 'Chat not found' });
        }

        // Check if user is admin of group chat
        const participant = chat.participants.find(p => p.user.toString() === socket.userId);
        const isAdmin = participant?.role === 'admin';
        const isSender = message.sender.toString() === socket.userId;

        if (!isAdmin && !isSender) {
          return callback({ error: 'Not authorized to delete this message' });
        }

        message.isDeleted = true;
        message.deletedBy = socket.userId;
        message.deletedAt = new Date();
        await message.save();

        // Notify all participants
        io.to(`chat:${message.chat}`).emit('message-deleted', {
          messageId,
          deletedBy: socket.userId,
          deletedAt: message.deletedAt
        });

        callback({ success: true });
      } catch (error) {
        console.error('Error deleting message:', error);
        callback({ error: error.message });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────────────────────────────────────

    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${socket.userId} - ${socket.user.name}`);
      await updateUserOnlineStatus(false);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};