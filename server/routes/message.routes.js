const express = require('express');
const router = express.Router();
const {
  getMessagesWithUser,
  getMessagesBetweenUsers,
  markMessagesAsRead,
  markMessageAsDelivered,
  searchMessages,
  deleteMessage
} = require('../controllers/message.controller');
const { protect } = require('../middlewares/auth.middleware');

router.get('/search', protect, searchMessages);
router.delete('/:id', protect, deleteMessage);
router.put('/read/:senderId', protect, markMessagesAsRead);
router.put('/delivered/:messageId', protect, markMessageAsDelivered);
router.get('/:userId/:otherUserId', protect, getMessagesBetweenUsers);
router.get('/:userId', protect, getMessagesWithUser);

module.exports = router;
