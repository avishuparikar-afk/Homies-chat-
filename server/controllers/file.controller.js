const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const File = require('../models/file.model');
const Message = require('../models/message.model');
const Group = require('../models/group.model');
const { uploadDir } = require('../middlewares/upload.middleware');

/**
 * Determine if an authenticated user is authorized to view/download a file
 */
const canUserAccessFile = async (user, fileDoc) => {
  if (!user || !fileDoc) return false;
  const userIdStr = user._id.toString();

  // 1. The original uploader is always authorized
  if (fileDoc.uploader.toString() === userIdStr) {
    return true;
  }

  // 2. Direct recipient specified on the file record
  if (fileDoc.recipient && fileDoc.recipient.toString() === userIdStr) {
    return true;
  }

  // 3. Member of the group specified on the file record
  if (fileDoc.groupId) {
    const group = await Group.findById(fileDoc.groupId);
    if (group && group.members.some((m) => m.toString() === userIdStr)) {
      return true;
    }
  }

  // 4. Check if file is associated with any Message document
  const escapedFileName = fileDoc.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const query = {
    $or: [
      { fileName: fileDoc.fileName },
      { fileUrl: { $regex: escapedFileName } },
      ...(fileDoc.messageId ? [{ _id: fileDoc.messageId }] : [])
    ]
  };

  const message = await Message.findOne(query);
  if (message) {
    // If message is direct one-to-one
    if (message.receiver) {
      if (
        message.sender.toString() === userIdStr ||
        message.receiver.toString() === userIdStr
      ) {
        return true;
      }
    }

    // If message is in a group
    if (message.groupId) {
      const group = await Group.findById(message.groupId);
      if (group && group.members.some((m) => m.toString() === userIdStr)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * @desc    Upload an attachment (image or document)
 * @route   POST /api/files/upload
 * @access  Private
 */
const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded or file field missing'
      });
    }

    const { conversationType, recipientId, groupId } = req.body;
    const isImage = req.file.mimetype.toLowerCase().startsWith('image/');
    const fileType = isImage ? 'image' : 'file';

    const newFile = await File.create({
      uploader: req.user._id,
      originalName: req.file.originalname,
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      fileType,
      conversationType: conversationType || null,
      recipient: recipientId && mongoose.Types.ObjectId.isValid(recipientId) ? recipientId : null,
      groupId: groupId && mongoose.Types.ObjectId.isValid(groupId) ? groupId : null
    });

    return res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      file: {
        _id: newFile._id,
        fileName: newFile.fileName,
        originalName: newFile.originalName,
        mimeType: newFile.mimeType,
        size: newFile.size,
        fileType: newFile.fileType,
        fileUrl: `/api/files/download/${newFile.fileName}`,
        viewUrl: `/api/files/view/${newFile.fileName}`
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    View an attachment inline (images / in-browser preview)
 * @route   GET /api/files/view/:fileName
 * @access  Private
 */
const viewFile = async (req, res, next) => {
  try {
    const { fileName } = req.params;
    const sanitizedFileName = path.basename(fileName);

    const fileDoc = await File.findOne({ fileName: sanitizedFileName });
    if (!fileDoc) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const authorized = await canUserAccessFile(req.user, fileDoc);
    if (!authorized) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: You do not have permission to view this file'
      });
    }

    const filePath = path.join(uploadDir, sanitizedFileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Physical file not found on server'
      });
    }

    res.setHeader('Content-Type', fileDoc.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileDoc.originalName)}"`
    );
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Download an attachment
 * @route   GET /api/files/download/:fileName
 * @access  Private
 */
const downloadFile = async (req, res, next) => {
  try {
    const { fileName } = req.params;
    const sanitizedFileName = path.basename(fileName);

    const fileDoc = await File.findOne({ fileName: sanitizedFileName });
    if (!fileDoc) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const authorized = await canUserAccessFile(req.user, fileDoc);
    if (!authorized) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: You do not have permission to download this file'
      });
    }

    const filePath = path.join(uploadDir, sanitizedFileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Physical file not found on server'
      });
    }

    res.setHeader('Content-Type', fileDoc.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileDoc.originalName)}"`
    );
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get file metadata
 * @route   GET /api/files/meta/:fileName
 * @access  Private
 */
const getFileMetadata = async (req, res, next) => {
  try {
    const { fileName } = req.params;
    const sanitizedFileName = path.basename(fileName);

    const fileDoc = await File.findOne({ fileName: sanitizedFileName });
    if (!fileDoc) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const authorized = await canUserAccessFile(req.user, fileDoc);
    if (!authorized) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: You do not have permission to view file metadata'
      });
    }

    return res.status(200).json({
      success: true,
      file: {
        _id: fileDoc._id,
        fileName: fileDoc.fileName,
        originalName: fileDoc.originalName,
        mimeType: fileDoc.mimeType,
        size: fileDoc.size,
        fileType: fileDoc.fileType,
        createdAt: fileDoc.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadFile,
  viewFile,
  downloadFile,
  getFileMetadata,
  canUserAccessFile
};
