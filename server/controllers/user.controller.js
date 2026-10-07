const mongoose = require('mongoose');
const User = require('../models/user.model');

/**
 * @desc    Get all users (excluding sensitive data)
 * @route   GET /api/users
 * @access  Private
 */
const getAllUsers = async (req, res, next) => {
  try {
    // Return all users excluding the currently authenticated user
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('-password')
      .sort({ online: -1, username: 1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get specific user profile by ID
 * @route   GET /api/users/:id
 * @access  Private
 */
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update current user profile (username, bio, profileImage)
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateProfile = async (req, res, next) => {
  try {
    const { username, bio, profileImage } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If username is being changed, validate and check for duplicates
    if (username && username.trim() !== user.username) {
      const trimmedUsername = username.trim();

      if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
        return res.status(400).json({
          success: false,
          message: 'Username must be between 3 and 30 characters'
        });
      }

      if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
        return res.status(400).json({
          success: false,
          message: 'Username can only contain letters, numbers, and underscores'
        });
      }

      const duplicate = await User.findOne({
        username: trimmedUsername,
        _id: { $ne: user._id }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Username is already taken by another user'
        });
      }

      user.username = trimmedUsername;
    }

    // Update bio if provided
    if (bio !== undefined) {
      if (bio.length > 120) {
        return res.status(400).json({
          success: false,
          message: 'Bio cannot exceed 120 characters'
        });
      }
      user.bio = bio.trim();
    }

    // Update profile image if provided
    if (profileImage !== undefined) {
      user.profileImage = profileImage.trim();
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: user.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Search users by username or email
 * @route   GET /api/users/search?q=
 * @access  Private
 */
const searchUsers = async (req, res, next) => {
  try {
    const searchQuery = req.query.q ? req.query.q.trim() : '';

    if (!searchQuery) {
      return res.status(200).json({
        success: true,
        count: 0,
        users: []
      });
    }

    // Escape regex special characters to prevent regex injection
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {
      _id: { $ne: req.user._id },
      $or: [
        { username: { $regex: escapedQuery, $options: 'i' } },
        { email: { $regex: escapedQuery, $options: 'i' } }
      ]
    };

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      count: users.length,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      users
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  updateProfile,
  searchUsers
};
