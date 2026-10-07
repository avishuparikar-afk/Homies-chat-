const mongoose = require('mongoose');
const Notification = require('../models/notification.model');

/**
 * @desc    Get current user's notifications and unread count
 * @route   GET /api/notifications
 * @access  Private
 */
const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('sender', 'username profileImage online')
        .populate('message', 'text messageType fileName fileUrl createdAt')
        .populate('groupId', 'name image'),
      Notification.countDocuments({ user: userId, read: false })
    ]);

    return res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount,
      notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark a single notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markNotificationAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Ensure notification belongs to current user
    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: Not your notification'
      });
    }

    if (!notification.read) {
      notification.read = true;
      await notification.save();
    }

    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      read: false
    });

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      notification,
      unreadCount
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all user notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, read: false },
      { $set: { read: true } }
    );

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount,
      unreadCount: 0
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
};
