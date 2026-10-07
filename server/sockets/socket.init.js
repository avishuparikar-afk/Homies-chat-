const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const { verifyToken } = require('../services/token.service');
const User = require('../models/user.model');
const Message = require('../models/message.model');
const Group = require('../models/group.model');
const File = require('../models/file.model');
const Notification = require('../models/notification.model');

// In-memory map to track active connections per user: Map<userId, Set<socketId>>
const userSocketsMap = new Map();

const initSocket = (httpServer, config) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          config.allowedOrigins.includes(origin) ||
          config.nodeEnv !== 'production'
        ) {
          return callback(null, true);
        }
        return callback(new Error(`CORS blocked socket connection from origin: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: config.socket?.pingTimeout || 20000,
    pingInterval: config.socket?.pingInterval || 25000,
    maxHttpBufferSize: config.socket?.maxHttpBufferSize || 1e7,
    transports: ['websocket', 'polling']
  });

  // Middleware to authenticate socket if token is provided
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (token) {
        try {
          const decoded = verifyToken(token);
          const user = await User.findById(decoded.id).select('-password');
          if (user) {
            socket.user = user;
          }
        } catch (tokenErr) {
          // Token invalid, allow connection as guest
        }
      }
      next();
    } catch (err) {
      next();
    }
  });

  io.on('connection', async (socket) => {
    console.log(
      `[Socket.IO] New client connected: ${socket.id} (User: ${socket.user ? socket.user.username : 'GUEST'})`
    );

    // If socket has authenticated user, join private room & handle presence
    if (socket.user) {
      const userId = socket.user._id.toString();

      // Join user's individual room for direct targeted message dispatch
      socket.join(`user:${userId}`);

      if (!userSocketsMap.has(userId)) {
        userSocketsMap.set(userId, new Set());
      }
      userSocketsMap.get(userId).add(socket.id);

      const isFirstConnection = userSocketsMap.get(userId).size === 1;

      // Asynchronously handle presence and group auto-joining without delaying listener registration
      (async () => {
        try {
          const userGroups = await Group.find({ members: socket.user._id }).select('_id');
          userGroups.forEach((g) => socket.join(`group:${g._id.toString()}`));
        } catch (grpErr) {
          console.error('Error auto-joining group rooms:', grpErr);
        }

        if (isFirstConnection) {
          try {
            const now = new Date();
            await User.findByIdAndUpdate(userId, { online: true, lastSeen: now });
            socket.broadcast.emit('user-online', { userId, lastSeen: now });
            socket.broadcast.emit('user:status', { userId, online: true, lastSeen: now });
          } catch (dbErr) {
            console.error('Error updating online presence:', dbErr);
          }
        }
      })();

      // --- ONE-TO-ONE CHAT EVENTS ---
      socket.on('send-message', async (data, callback) => {
        try {
          const receiverId = data.receiver || data.receiverId;
          const text = data.text ? data.text.trim() : '';
          const fileUrl = data.fileUrl || null;

          if (!receiverId || (!text && !fileUrl)) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Receiver and text or file are required' });
            }
            return;
          }

          if (!mongoose.Types.ObjectId.isValid(receiverId)) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Invalid receiver ID' });
            }
            return;
          }

          const messageType =
            data.messageType ||
            (fileUrl
              ? data.fileMimeType?.toLowerCase().startsWith('image/')
                ? 'image'
                : 'file'
              : 'text');

          // Persist message in MongoDB with status: 'sent'
          const newMessage = await Message.create({
            sender: socket.user._id,
            receiver: receiverId,
            text: text || data.fileName || '',
            messageType,
            fileUrl,
            fileName: data.fileName || null,
            fileSize: data.fileSize || null,
            fileMimeType: data.fileMimeType || null,
            status: 'sent'
          });

          // Link file record to message and recipient
          if (fileUrl) {
            const parsedFileName = path.basename(fileUrl);
            await File.findOneAndUpdate(
              { fileName: parsedFileName },
              {
                messageId: newMessage._id,
                recipient: receiverId,
                conversationType: 'direct'
              }
            );
          }

          // Populate sender and receiver for client consumption
          const populatedMessage = await Message.findById(newMessage._id)
            .populate('sender', 'username profileImage online')
            .populate('receiver', 'username profileImage online');

          // Emit 'message-sent' event to sender
          io.to(`user:${userId}`).emit('message-sent', {
            messageId: populatedMessage._id.toString(),
            message: populatedMessage,
            status: 'sent'
          });

          // Create real-time notification for the recipient
          try {
            const newNotif = await Notification.create({
              user: receiverId,
              sender: socket.user._id,
              message: newMessage._id,
              type: 'MESSAGE',
              read: false
            });

            const populatedNotif = await Notification.findById(newNotif._id)
              .populate('sender', 'username profileImage online')
              .populate('message', 'text messageType fileName fileUrl createdAt');

            io.to(`user:${receiverId}`).emit('new-notification', populatedNotif);
          } catch (notifErr) {
            console.error('[Socket.IO] Error creating notification:', notifErr);
          }

          // Route to receiver's private room
          io.to(`user:${receiverId}`).emit('receive-message', populatedMessage);

          // Echo back to sender's sockets for sync
          io.to(`user:${userId}`).emit('receive-message', populatedMessage);

          if (typeof callback === 'function') {
            callback({ success: true, message: populatedMessage });
          }
        } catch (error) {
          console.error('[Socket.IO] Error in send-message:', error);
          if (typeof callback === 'function') {
            callback({ success: false, message: error.message });
          }
        }
      });

      socket.on('message-delivered', async (data) => {
        try {
          const messageId = data?.messageId;
          const senderId = data?.senderId;

          if (messageId && mongoose.Types.ObjectId.isValid(messageId)) {
            const updated = await Message.findOneAndUpdate(
              { _id: new mongoose.Types.ObjectId(messageId), receiver: socket.user._id, status: 'sent' },
              { status: 'delivered' },
              { new: true }
            );

            if (updated) {
              const targetSender = (senderId || updated.sender).toString();
              io.to(`user:${targetSender}`).emit('message-delivered', {
                messageId: updated._id.toString(),
                senderId: targetSender,
                receiverId: socket.user._id.toString(),
                status: 'delivered'
              });
              io.to(`user:${targetSender}`).emit('message-status-updated', {
                messageId: updated._id.toString(),
                senderId: targetSender,
                receiverId: socket.user._id.toString(),
                status: 'delivered'
              });
            }
          } else if (senderId && mongoose.Types.ObjectId.isValid(senderId)) {
            await Message.updateMany(
              { sender: senderId, receiver: socket.user._id, status: 'sent' },
              { status: 'delivered' }
            );

            io.to(`user:${senderId}`).emit('message-delivered', {
              senderId,
              receiverId: socket.user._id.toString(),
              status: 'delivered'
            });
            io.to(`user:${senderId}`).emit('message-status-updated', {
              senderId,
              receiverId: socket.user._id.toString(),
              status: 'delivered'
            });
          }
        } catch (delivErr) {
          console.error('[Socket.IO] Error handling message-delivered:', delivErr);
        }
      });

      socket.on('message-read', async (data) => {
        try {
          const senderId = data?.senderId;
          const messageId = data?.messageId;

          if (messageId && mongoose.Types.ObjectId.isValid(messageId)) {
            const updated = await Message.findOneAndUpdate(
              { _id: messageId, receiver: socket.user._id },
              { status: 'read' },
              { new: true }
            );

            if (updated) {
              const targetSender = senderId || updated.sender.toString();
              io.to(`user:${targetSender}`).emit('message-read', {
                messageId: updated._id.toString(),
                senderId: targetSender,
                readerId: socket.user._id.toString(),
                status: 'read'
              });
              io.to(`user:${targetSender}`).emit('message-status-updated', {
                messageId: updated._id.toString(),
                senderId: targetSender,
                readerId: socket.user._id.toString(),
                status: 'read'
              });
            }
          } else if (senderId && mongoose.Types.ObjectId.isValid(senderId)) {
            await Message.updateMany(
              { sender: senderId, receiver: socket.user._id, status: { $ne: 'read' } },
              { status: 'read' }
            );

            io.to(`user:${senderId}`).emit('message-read', {
              senderId,
              readerId: socket.user._id.toString(),
              status: 'read'
            });
            io.to(`user:${senderId}`).emit('message-status-updated', {
              senderId,
              readerId: socket.user._id.toString(),
              status: 'read'
            });
          }
        } catch (readErr) {
          console.error('[Socket.IO] Error handling message-read:', readErr);
        }
      });

      socket.on('typing', (data) => {
        const receiverId = data?.receiver || data?.receiverId;
        if (receiverId) {
          io.to(`user:${receiverId}`).emit('typing', {
            sender: socket.user._id,
            username: socket.user.username
          });
        }
      });

      socket.on('stop-typing', (data) => {
        const receiverId = data?.receiver || data?.receiverId;
        if (receiverId) {
          io.to(`user:${receiverId}`).emit('stop-typing', {
            sender: socket.user._id
          });
        }
      });

      // --- GROUP CHAT EVENTS (PHASE 6) ---
      socket.on('join-group', async (data) => {
        const groupId = data?.groupId;
        if (groupId && mongoose.Types.ObjectId.isValid(groupId)) {
          const isMember = await Group.exists({ _id: groupId, members: socket.user._id });
          if (isMember) {
            socket.join(`group:${groupId}`);
            socket.emit('joined-group', { groupId });
          }
        }
      });

      socket.on('leave-group', (data) => {
        const groupId = data?.groupId;
        if (groupId) {
          socket.leave(`group:${groupId}`);
          socket.emit('left-group', { groupId });
        }
      });

      socket.on('group-message', async (data, callback) => {
        try {
          const groupId = data?.groupId;
          const text = data?.text ? data.text.trim() : '';
          const fileUrl = data?.fileUrl || null;

          if (!groupId || (!text && !fileUrl) || !mongoose.Types.ObjectId.isValid(groupId)) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Invalid groupId or empty message' });
            }
            return;
          }

          const group = await Group.findById(groupId);
          if (!group || !group.members.some((m) => m.toString() === socket.user._id.toString())) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'You are not a member of this group' });
            }
            return;
          }

          const messageType =
            data.messageType ||
            (fileUrl
              ? data.fileMimeType?.toLowerCase().startsWith('image/')
                ? 'image'
                : 'file'
              : 'text');

          // Persist message in MongoDB with groupId
          const newMsg = await Message.create({
            sender: socket.user._id,
            groupId,
            text: text || data?.fileName || '',
            messageType,
            fileUrl,
            fileName: data?.fileName || null,
            fileSize: data?.fileSize || null,
            fileMimeType: data?.fileMimeType || null,
            status: 'sent'
          });

          // Link file record to message and group
          if (fileUrl) {
            const parsedFileName = path.basename(fileUrl);
            await File.findOneAndUpdate(
              { fileName: parsedFileName },
              {
                messageId: newMsg._id,
                groupId,
                conversationType: 'group'
              }
            );
          }

          const populatedMessage = await Message.findById(newMsg._id)
            .populate('sender', 'username profileImage online');

          // Create real-time notifications for all other group members
          try {
            const memberNotifications = group.members
              .filter((m) => m.toString() !== socket.user._id.toString())
              .map((memberId) => ({
                user: memberId,
                sender: socket.user._id,
                message: newMsg._id,
                groupId,
                type: 'GROUP_MESSAGE',
                read: false
              }));

            if (memberNotifications.length > 0) {
              const insertedNotifs = await Notification.insertMany(memberNotifications);
              insertedNotifs.forEach((n) => {
                const notifPayload = {
                  _id: n._id,
                  user: n.user,
                  sender: {
                    _id: socket.user._id,
                    username: socket.user.username,
                    profileImage: socket.user.profileImage
                  },
                  message: {
                    _id: newMsg._id,
                    text: newMsg.text,
                    messageType: newMsg.messageType,
                    fileName: newMsg.fileName,
                    fileUrl: newMsg.fileUrl,
                    createdAt: newMsg.createdAt
                  },
                  groupId: {
                    _id: group._id,
                    name: group.name,
                    image: group.image
                  },
                  type: 'GROUP_MESSAGE',
                  read: false,
                  createdAt: n.createdAt
                };
                io.to(`user:${n.user.toString()}`).emit('new-notification', notifPayload);
              });
            }
          } catch (notifErr) {
            console.error('[Socket.IO] Error creating group notifications:', notifErr);
          }

          // Broadcast to all sockets in the group room
          io.to(`group:${groupId}`).emit('group-message', populatedMessage);

          if (typeof callback === 'function') {
            callback({ success: true, message: populatedMessage });
          }
        } catch (grpMsgErr) {
          console.error('[Socket.IO] Error in group-message:', grpMsgErr);
          if (typeof callback === 'function') {
            callback({ success: false, message: grpMsgErr.message });
          }
        }
      });

      socket.on('group-typing', (data) => {
        const groupId = data?.groupId;
        if (groupId && socket.rooms.has(`group:${groupId}`)) {
          socket.to(`group:${groupId}`).emit('group-typing', {
            groupId,
            sender: socket.user._id,
            username: socket.user.username
          });
        }
      });

      socket.on('group-stop-typing', (data) => {
        const groupId = data?.groupId;
        if (groupId && socket.rooms.has(`group:${groupId}`)) {
          socket.to(`group:${groupId}`).emit('group-stop-typing', {
            groupId,
            sender: socket.user._id
          });
        }
      });

      // --- MESSAGE DELETION EVENT (PHASE 10) ---
      socket.on('delete-message', async (data, callback) => {
        try {
          const messageId = data?.messageId;
          const deleteType = (data?.type || 'me').toLowerCase();

          if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Invalid message ID' });
            }
            return;
          }

          const message = await Message.findById(messageId);
          if (!message) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Message not found' });
            }
            return;
          }

          const userIdStr = socket.user._id.toString();
          const senderIdStr = message.sender.toString();
          const isSender = senderIdStr === userIdStr;
          const isReceiver = message.receiver && message.receiver.toString() === userIdStr;

          let isGroupMember = false;
          let isGroupAdmin = false;
          if (message.groupId) {
            const group = await Group.findById(message.groupId);
            if (group) {
              isGroupMember = group.members.some((m) => m.toString() === userIdStr);
              isGroupAdmin = group.admins.some((a) => a.toString() === userIdStr);
            }
          }

          const isParticipant = isSender || isReceiver || isGroupMember;
          if (!isParticipant) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Access forbidden: You are not a participant in this conversation' });
            }
            return;
          }

          if (deleteType === 'everyone') {
            const canDeleteForEveryone = isSender || isGroupAdmin;
            if (!canDeleteForEveryone) {
              if (typeof callback === 'function') {
                callback({
                  success: false,
                  message: 'Only the sender can delete their own message unless group admin permissions explicitly allow otherwise'
                });
              }
              return;
            }

            message.isDeletedForEveryone = true;
            message.text = 'This message was deleted';
            message.messageType = 'text';
            message.fileUrl = null;
            message.fileName = null;
            message.fileSize = null;
            message.fileMimeType = null;
            message.deletedAt = new Date();

            await message.save();

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

            if (typeof callback === 'function') {
              callback({ success: true, message });
            }
          } else {
            // Delete for me
            if (!message.deletedFor.some((u) => u.toString() === userIdStr)) {
              message.deletedFor.push(socket.user._id);
              await message.save();
            }

            if (typeof callback === 'function') {
              callback({ success: true, messageId: message._id });
            }
          }
        } catch (delErr) {
          console.error('[Socket.IO] Error in delete-message:', delErr);
          if (typeof callback === 'function') {
            callback({ success: false, message: delErr.message });
          }
        }
      });
    }

    // Heartbeat ping-pong test event (Phase 1 preserved)
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    socket.on('disconnect', async (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);

      if (socket.user) {
        const userId = socket.user._id.toString();
        const userSockets = userSocketsMap.get(userId);

        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            userSocketsMap.delete(userId);

            // User has no remaining sockets: mark offline
            try {
              const now = new Date();
              await User.findByIdAndUpdate(userId, { online: false, lastSeen: now });

              // Emit offline events
              socket.broadcast.emit('user-offline', { userId, lastSeen: now });
              socket.broadcast.emit('user:status', { userId, online: false, lastSeen: now });
            } catch (dbErr) {
              console.error('Error updating offline presence:', dbErr);
            }
          }
        }
      }
    });
  });

  return io;
};

module.exports = initSocket;
