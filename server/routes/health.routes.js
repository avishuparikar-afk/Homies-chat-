const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/health
 * @desc    Check health status of backend server
 * @access  Public
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running'
  });
});

module.exports = router;
