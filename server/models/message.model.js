const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
        return !this.groupId;
      },
      index: true
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
      index: true
    },
    text: {
      type: String,
      required: function () {
        return this.messageType === 'text' && !this.fileUrl;
      },
      default: '',
      trim: true
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'file'],
      default: 'text'
    },
    fileUrl: {
      type: String,
      default: null
    },
    fileName: {
      type: String,
      default: null
    },
    fileSize: {
      type: Number,
      default: null
    },
    fileMimeType: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'SENT', 'DELIVERED', 'READ'],
      default: 'sent'
    },
    isDeletedForEveryone: {
      type: Boolean,
      default: false
    },
    deletedAt: {
      type: Date,
      default: null
    },
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ]
  },
  {
    timestamps: true
  }
);

// Compound indexes for optimal chat history queries
messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 });
messageSchema.index({ receiver: 1, sender: 1, createdAt: 1 });
messageSchema.index({ groupId: 1, createdAt: 1 });

// Performance indexes for bulk status updates, file matching, and search
messageSchema.index({ sender: 1, receiver: 1, status: 1 });
messageSchema.index({ fileName: 1 });
messageSchema.index({ deletedFor: 1 });
messageSchema.index({ text: 'text' });

module.exports = mongoose.model('Message', messageSchema);
