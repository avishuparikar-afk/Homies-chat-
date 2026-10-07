const mongoose = require('mongoose');
const Group = require('../models/group.model');
const User = require('../models/user.model');
const Message = require('../models/message.model');
const Notification = require('../models/notification.model');

/**
 * @desc    Create a new group
 * @route   POST /api/groups
 * @access  Private
 */
const createGroup = async (req, res, next) => {
  try {
    const { name, description, image, members } = req.body;

    if (!name || name.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Group name must be at least 3 characters long'
      });
    }

    // Ensure member IDs array contains current user and unique valid ObjectIds
    const memberSet = new Set();
    memberSet.add(req.user._id.toString());

    if (Array.isArray(members)) {
      members.forEach((mId) => {
        if (mongoose.Types.ObjectId.isValid(mId)) {
          memberSet.add(mId.toString());
        }
      });
    }

    const memberList = Array.from(memberSet).map((id) => new mongoose.Types.ObjectId(id));

    const group = await Group.create({
      name: name.trim(),
      description: description ? description.trim() : '',
      image: image || '👥',
      createdBy: req.user._id,
      admins: [req.user._id],
      members: memberList
    });

    const populatedGroup = await Group.findById(group._id)
      .populate('admins', 'username profileImage online')
      .populate('members', 'username profileImage online')
      .populate('createdBy', 'username profileImage online');

    const io = req.app.get('io');
    if (io) {
      memberList.forEach((memberId) => {
        io.to(`user:${memberId.toString()}`).emit('group-created', populatedGroup);
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Group created successfully',
      group: populatedGroup
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all groups the authenticated user belongs to
 * @route   GET /api/groups
 * @access  Private
 */
const getUserGroups = async (req, res, next) => {
  try {
    const groups = await Group.find({ members: req.user._id })
      .sort({ updatedAt: -1 })
      .populate('admins', 'username profileImage online')
      .populate('members', 'username profileImage online')
      .populate('createdBy', 'username profileImage online');

    return res.status(200).json({
      success: true,
      count: groups.length,
      groups
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single group details
 * @route   GET /api/groups/:id
 * @access  Private
 */
const getGroupById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid group ID format'
      });
    }

    const group = await Group.findById(id)
      .populate('admins', 'username profileImage online')
      .populate('members', 'username profileImage online')
      .populate('createdBy', 'username profileImage online');

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const isMember = group.members.some((m) => m._id.toString() === req.user._id.toString());
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: You are not a member of this group'
      });
    }

    return res.status(200).json({
      success: true,
      group
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update group details (name, description, image)
 * @route   PUT /api/groups/:id
 * @access  Private (Admins only)
 */
const updateGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, image } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid group ID format'
      });
    }

    const group = await Group.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if requester is admin
    const isAdmin = group.admins.some((a) => a.toString() === req.user._id.toString());
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only group admins can update group information'
      });
    }

    if (name) group.name = name.trim();
    if (description !== undefined) group.description = description.trim();
    if (image) group.image = image.trim();

    await group.save();

    const updatedGroup = await Group.findById(id)
      .populate('admins', 'username profileImage online')
      .populate('members', 'username profileImage online')
      .populate('createdBy', 'username profileImage online');

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${id}`).emit('group-updated', updatedGroup);
    }

    return res.status(200).json({
      success: true,
      message: 'Group updated successfully',
      group: updatedGroup
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add member to group
 * @route   POST /api/groups/:id/members
 * @access  Private (Admins only)
 */
const addGroupMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const group = await Group.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if requester is admin
    const isAdmin = group.admins.some((a) => a.toString() === req.user._id.toString());
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only group admins can add members'
      });
    }

    // Check target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User to add not found'
      });
    }

    // Check if already a member
    const alreadyMember = group.members.some((m) => m.toString() === userId.toString());
    if (alreadyMember) {
      return res.status(400).json({
        success: false,
        message: 'User is already a member of this group'
      });
    }

    group.members.push(new mongoose.Types.ObjectId(userId));
    await group.save();

    const updatedGroup = await Group.findById(id)
      .populate('admins', 'username profileImage online')
      .populate('members', 'username profileImage online')
      .populate('createdBy', 'username profileImage online');

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${id}`).emit('group-member-added', {
        groupId: id,
        user: targetUser.toJSON()
      });
      io.to(`user:${userId}`).emit('group-created', updatedGroup);
    }

    return res.status(200).json({
      success: true,
      message: 'Member added successfully',
      group: updatedGroup
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove member from group or leave group
 * @route   DELETE /api/groups/:id/members/:userId
 * @access  Private
 */
const removeGroupMember = async (req, res, next) => {
  try {
    const { id, userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const group = await Group.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const isSelfLeaving = req.user._id.toString() === userId.toString();
    const isRequesterAdmin = group.admins.some((a) => a.toString() === req.user._id.toString());

    // If not leaving oneself, requester MUST be an admin
    if (!isSelfLeaving && !isRequesterAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only group admins can remove other members'
      });
    }

    // Check if target is actually a member
    const isMember = group.members.some((m) => m.toString() === userId.toString());
    if (!isMember) {
      return res.status(400).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Remove from members and admins
    group.members = group.members.filter((m) => m.toString() !== userId.toString());
    group.admins = group.admins.filter((a) => a.toString() !== userId.toString());

    // If user was an admin and no admins remain, promote first available member
    if (group.admins.length === 0 && group.members.length > 0) {
      group.admins.push(group.members[0]);
    }

    await group.save();

    const updatedGroup = await Group.findById(id)
      .populate('admins', 'username profileImage online')
      .populate('members', 'username profileImage online')
      .populate('createdBy', 'username profileImage online');

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${id}`).emit('group-member-removed', {
        groupId: id,
        userId
      });
    }

    return res.status(200).json({
      success: true,
      message: isSelfLeaving ? 'You have left the group' : 'Member removed successfully',
      group: updatedGroup
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get message history for group
 * @route   GET /api/groups/:id/messages
 * @access  Private
 */
const getGroupMessages = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid group ID format'
      });
    }

    const group = await Group.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const isMember = group.members.some((m) => m.toString() === req.user._id.toString());
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: You are not a member of this group'
      });
    }

    const page = parseInt(req.query.page) || null;
    const limit = parseInt(req.query.limit) || null;

    let groupMsgQuery = Message.find({
      groupId: id,
      deletedFor: { $ne: req.user._id }
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'username profileImage online');

    if (limit) {
      const skip = page ? (page - 1) * limit : 0;
      groupMsgQuery = groupMsgQuery.skip(skip).limit(limit);
    }

    const messages = await groupMsgQuery;

    // Mark unread notifications for this group as read
    await Notification.updateMany(
      { user: req.user._id, groupId: id, read: false },
      { $set: { read: true } }
    );

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
 * @desc    Search groups by name or description
 * @route   GET /api/groups/search?q=&page=&limit=
 * @access  Private
 */
const searchGroups = async (req, res, next) => {
  try {
    const searchQuery = req.query.q ? req.query.q.trim() : '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {
      members: req.user._id
    };

    if (searchQuery) {
      const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedQuery, $options: 'i' } },
        { description: { $regex: escapedQuery, $options: 'i' } }
      ];
    }

    const [groups, total] = await Promise.all([
      Group.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('admins', 'username profileImage')
        .populate('members', 'username profileImage')
        .populate('createdBy', 'username profileImage'),
      Group.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      count: groups.length,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      groups
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createGroup,
  getUserGroups,
  getGroupById,
  updateGroup,
  addGroupMember,
  removeGroupMember,
  getGroupMessages,
  searchGroups
};
