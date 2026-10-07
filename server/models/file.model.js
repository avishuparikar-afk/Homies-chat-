const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
  {
    uploader: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    originalName: {
      type: String,
      required: true,
      trim: true
    },
    fileName: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    mimeType: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    fileType: {
      type: String,
      enum: ['image', 'file'],
      required: true
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
      index: true
    },
    conversationType: {
      type: String,
      enum: ['direct', 'group', null],
      default: null
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('File', fileSchema);
