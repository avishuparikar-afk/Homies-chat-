const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      required: true
    },
    type: {
      type: String,
      enum: ['MESSAGE', 'GROUP_MESSAGE'],
      required: true
    },
    read: {
      type: Boolean,
      default: false,
      index: true
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for optimal querying of unread user notifications
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ user: 1, sender: 1, read: 1 });
notificationSchema.index({ user: 1, groupId: 1, read: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
