const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const { handleUpload } = require('../middlewares/upload.middleware');
const {
  uploadFile,
  viewFile,
  downloadFile,
  getFileMetadata
} = require('../controllers/file.controller');

// All file routes require authentication
router.post('/upload', protect, handleUpload, uploadFile);
router.get('/view/:fileName', protect, viewFile);
router.get('/download/:fileName', protect, downloadFile);
router.get('/meta/:fileName', protect, getFileMetadata);

module.exports = router;
