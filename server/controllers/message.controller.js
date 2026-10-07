const mongoose = require('mongoose');
const Message = require('../models/message.model');
const User = require('../models/user.model');
const Group = require('../models/group.model');
const Notification = require('../models/notification.model');

/**
 * @desc    Get chat history between authenticated user and another user
 * @route   GET /api/messages/:userId
 * @access  Private
 */
const getMessagesWithUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Verify other user exists
    const otherUser = await User.findById(userId).select('-password');
    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const page = parseInt(req.query.page) || null;
    const limit = parseInt(req.query.limit) || null;

    let messageQuery = Message.find({
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id }
      ],
      deletedFor: { $ne: req.user._id }
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'username profileImage online')
      .populate('receiver', 'username profileImage online');

    if (limit) {
      const skip = page ? (page - 1) * limit : 0;
      messageQuery = messageQuery.skip(skip).limit(limit);
    }

    const messages = await messageQuery;

    return res.status(200).json({
      success: true,
      count: messages.length,
      page: page || 1,
      messages
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get chat history between two specific users
 * @route   GET /api/messages/:userId/:otherUserId
 * @access  Private
 */
const getMessagesBetweenUsers = async (req, res, next) => {
  try {
    const { userId, otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Ensure requesting user is one of the conversation participants
    const isParticipant =
      req.user._id.toString() === userId.toString() ||
      req.user._id.toString() === otherUserId.toString();

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: You are not a participant in this conversation'
      });
    }

    const page = parseInt(req.query.page) || null;
    const limit = parseInt(req.query.limit) || null;

    let messageQuery = Message.find({
      $or: [
        { sender: userId, receiver: otherUserId },
        { sender: otherUserId, receiver: userId }
      ],
      deletedFor: { $ne: req.user._id }
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'username profileImage online')
      .populate('receiver', 'username profileImage online');

    if (limit) {
      const skip = page ? (page - 1) * limit : 0;
      messageQuery = messageQuery.skip(skip).limit(limit);
    }

    const messages = await messageQuery;

    return res.status(200).json({
      success: true,
      count: messages.length,
      page: page || 1,
      messages
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all messages from sender as read
 * @route   PUT /api/messages/read/:senderId
 * @access  Private
 */
const markMessagesAsRead = async (req, res, next) => {
  try {
    const { senderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(senderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sender ID format'
      });
    }

    const result = await Message.updateMany(
      { sender: senderId, receiver: req.user._id, status: { $ne: 'read' } },
      { status: 'read' }
    );

    // Also mark notifications from this sender as read
    await Notification.updateMany(
      { user: req.user._id, sender: senderId, read: false },
      { $set: { read: true } }
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${senderId}`).emit('message-read', {
        senderId,
        readerId: req.user._id.toString(),
        status: 'read'
      });
      io.to(`user:${senderId}`).emit('message-status-updated', {
        senderId,
        readerId: req.user._id.toString(),
        status: 'read'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Messages marked as read',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark a specific message as delivered
 * @route   PUT /api/messages/delivered/:messageId
 * @access  Private
 */
const markMessageAsDelivered = async (req, res, next) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID format'
      });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    if (message.receiver.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update delivery for this message'
      });
    }

    if (message.status === 'sent') {
      message.status = 'delivered';
      await message.save();

      const io = req.app.get('io');
      if (io) {
        io.to(`user:${message.sender}`).emit('message-delivered', {
          messageId: message._id.toString(),
          senderId: message.sender.toString(),
          receiverId: req.user._id.toString(),
          status: 'delivered'
        });
        io.to(`user:${message.sender}`).emit('message-status-updated', {
          messageId: message._id.toString(),
          senderId: message.sender.toString(),
          receiverId: req.user._id.toString(),
          status: 'delivered'
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Message marked as delivered',
      status: message.status
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Search messages by text, conversation, and date with pagination
 * @route   GET /api/messages/search?q=&conversationId=&conversationType=&userId=&groupId=&date=&startDate=&endDate=&page=&limit=
 * @access  Private
 */
const searchMessages = async (req, res, next) => {
  try {
    const {
      q,
      conversationId,
      conversationType,
      userId,
      groupId,
      date,
      startDate,
      endDate
    } = req.query;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const andConditions = [];

    // 1. Conversation scoping
    const targetGroupId = groupId || (conversationType === 'group' ? conversationId : null);
    const targetUserId = userId || (conversationType === 'direct' ? conversationId : null);

    if (targetGroupId) {
      if (!mongoose.Types.ObjectId.isValid(targetGroupId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid group ID format'
        });
      }

      // Check if user is a member of this group
      const group = await Group.findOne({ _id: targetGroupId, members: req.user._id });
      if (!group) {
        return res.status(403).json({
          success: false,
          message: 'Access forbidden: You are not a member of this group or group does not exist'
        });
      }

      andConditions.push({ groupId: targetGroupId });
    } else if (targetUserId) {
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID format'
        });
      }

      // In direct message conversation between req.user and targetUserId
      andConditions.push({
        groupId: null,
        $or: [
          { sender: req.user._id, receiver: targetUserId },
          { sender: targetUserId, receiver: req.user._id }
        ]
      });
    } else if (conversationId) {
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid conversation ID format'
        });
      }

      const isGroup = await Group.findOne({ _id: conversationId, members: req.user._id });
      if (isGroup) {
        andConditions.push({ groupId: conversationId });
      } else {
        andConditions.push({
          groupId: null,
          $or: [
            { sender: req.user._id, receiver: conversationId },
            { sender: conversationId, receiver: req.user._id }
          ]
        });
      }
    } else {
      // Global scope: messages accessible by authenticated user
      const userGroups = await Group.find({ members: req.user._id }).select('_id');
      const groupIds = userGroups.map((g) => g._id);

      andConditions.push({
        $or: [
          { sender: req.user._id },
          { receiver: req.user._id },
          { groupId: { $in: groupIds } }
        ]
      });
    }

    // 2. Text search
    if (q && q.trim()) {
      const escapedQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedQuery, 'i');
      andConditions.push({
        $or: [
          { text: { $regex: regex } },
          { fileName: { $regex: regex } }
        ]
      });
    }

    // 3. Date filtering
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const startOfDay = new Date(d);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(d);
        endOfDay.setHours(23, 59, 59, 999);
        andConditions.push({
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        });
      }
    } else {
      const dateRange = {};
      if (startDate) {
        const s = new Date(startDate);
        if (!isNaN(s.getTime())) {
          dateRange.$gte = s;
        }
      }
      if (endDate) {
        const e = new Date(endDate);
        if (!isNaN(e.getTime())) {
          if (endDate.length <= 10) {
            e.setHours(23, 59, 59, 999);
          }
          dateRange.$lte = e;
        }
      }
      if (Object.keys(dateRange).length > 0) {
        andConditions.push({ createdAt: dateRange });
      }
    }

    // Exclude messages deleted for current user
    andConditions.push({ deletedFor: { $ne: req.user._id } });

    const filter = andConditions.length > 0 ? { $and: andConditions } : {};

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sender', 'username profileImage online')
        .populate('receiver', 'username profileImage online')
        .populate('groupId', 'name image'),
      Message.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      count: messages.length,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      messages
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete message (Delete for me OR Delete for everyone)
 * @route   DELETE /api/messages/:id?type=me|everyone
 * @access  Private
 */
const deleteMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleteType = (req.query.type || req.body?.type || 'me').toLowerCase();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID format'
      });
    }

    const message = await Message.findById(id);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    const userIdStr = req.user._id.toString();
    const senderIdStr = message.sender.toString();
    const isSender = senderIdStr === userIdStr;
    const isReceiver = message.receiver && message.receiver.toString() === userIdStr;

    // Check group membership and admin status if group message
    let isGroupMember = false;
    let isGroupAdmin = false;
    if (message.groupId) {
      const group = await Group.findById(message.groupId);
      if (group) {
        isGroupMember = group.members.some((m) => m.toString() === userIdStr);
        isGroupAdmin = group.admins.some((a) => a.toString() === userIdStr);
      }
    }

    // Check if user is a participant
    const isParticipant = isSender || isReceiver || isGroupMember;
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: You are not a participant in this conversation'
      });
    }

    if (deleteType === 'everyone') {
      // Authorization check for delete for everyone:
      // Only the sender can delete their own message unless group admin permissions explicitly allow otherwise
      const canDeleteForEveryone = isSender || isGroupAdmin;
      if (!canDeleteForEveryone) {
        return res.status(403).json({
          success: false,
          message: 'Only the sender can delete their own message unless group admin permissions explicitly allow otherwise'
        });
      }

      // Do not physically remove the message if doing so would break chat history/status logic; replace content with "This message was deleted"
      message.isDeletedForEveryone = true;
      message.text = 'This message was deleted';
      message.messageType = 'text';
      message.fileUrl = null;
      message.fileName = null;
      message.fileSize = null;
      message.fileMimeType = null;
      message.deletedAt = new Date();

      await message.save();

      // Synchronize deletion through Socket.IO
      const io = req.app.get('io');
      if (io) {
        const payload = {
          messageId: message._id.toString(),
          type: 'everyone',
          message: {
            _id: message._id,
            sender: message.sender,
            receiver: message.receiver,
            groupId: message.groupId,
            text: message.text,
            messageType: 'text',
            isDeletedForEveryone: true,
            deletedAt: message.deletedAt,
            status: message.status,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt
          }
        };

        if (message.groupId) {
          io.to(`group:${message.groupId}`).emit('message-deleted', payload);
        } else {
          io.to(`user:${message.receiver}`).emit('message-deleted', payload);
          io.to(`user:${message.sender}`).emit('message-deleted', payload);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Message deleted for everyone',
        deleteType: 'everyone',
        data: message
      });
    } else {
      // Delete for me
      if (!message.deletedFor.some((u) => u.toString() === userIdStr)) {
        message.deletedFor.push(req.user._id);
        await message.save();
      }

      return res.status(200).json({
        success: true,
        message: 'Message deleted for you',
        deleteType: 'me',
        messageId: message._id
      });
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMessagesWithUser,
  getMessagesBetweenUsers,
  markMessagesAsRead,
  markMessageAsDelivered,
  searchMessages,
  deleteMessage
};
