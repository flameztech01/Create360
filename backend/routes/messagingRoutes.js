// routes/messagingRoutes.js
import express from 'express';
import {
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
  updateOnlineStatus  // ← ADD THIS IMPORT
} from '../controllers/messagingController.js';
import { protect } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Chat management
router.post('/group', protect, createGroupChat);
router.post('/direct', protect, createDirectChat);
router.get('/chats', protect, getUserChats);
router.get('/search/users', protect, searchUsers);

// Online status (NEW)
router.post('/online-status', protect, updateOnlineStatus);  // ← ADD THIS

// Chat messages
router.get('/:chatId', protect, getChatMessages);
router.post('/:chatId', protect, upload.single('media'), sendMessage);
router.use((err, req, res, next) => {
  console.error('MIDDLEWARE ERROR:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});
router.delete('/:messageId', protect, deleteMessage);

// Typing indicators
router.post('/:chatId/typing', protect, startTyping);
router.delete('/:chatId/typing', protect, stopTyping);
router.get('/:chatId/typing', protect, getTypingUsers);

// Read receipts
router.post('/:chatId/read', protect, markChatAsRead);

// Participant management
router.post('/:chatId/participants', protect, addParticipant);
router.delete('/:chatId/participants/:userId', protect, removeParticipant);

export default router;