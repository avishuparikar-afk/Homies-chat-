const express = require('express');
const router = express.Router();
const {
  createGroup,
  getUserGroups,
  getGroupById,
  updateGroup,
  addGroupMember,
  removeGroupMember,
  getGroupMessages,
  searchGroups
} = require('../controllers/group.controller');
const { protect } = require('../middlewares/auth.middleware');

router.post('/', protect, createGroup);
router.get('/', protect, getUserGroups);
router.get('/search', protect, searchGroups);
router.get('/:id', protect, getGroupById);
router.put('/:id', protect, updateGroup);
router.post('/:id/members', protect, addGroupMember);
router.delete('/:id/members/:userId', protect, removeGroupMember);
router.get('/:id/messages', protect, getGroupMessages);

module.exports = router;
