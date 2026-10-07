const express = require('express');
const router = express.Router();
const {
  getAllUsers,
  getUserById,
  updateProfile,
  searchUsers
} = require('../controllers/user.controller');
const { protect } = require('../middlewares/auth.middleware');

router.get('/', protect, getAllUsers);
router.get('/search', protect, searchUsers);
router.put('/profile', protect, updateProfile);
router.get('/:id', protect, getUserById);

module.exports = router;
