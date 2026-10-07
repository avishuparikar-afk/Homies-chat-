const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Target directory for uploaded files (isolated from public web root)
const uploadDir = path.resolve(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Whitelist of supported extensions
const ALLOWED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf',
  '.doc',
  '.docx',
  '.txt'
];

// Whitelist of allowed MIME types
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];

// Explicit blacklist of dangerous executable and script extensions
const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.bin', '.js', '.mjs', '.vbs', '.msi',
  '.com', '.scr', '.pif', '.application', '.gadget', '.hta', '.cpl',
  '.msc', '.jar', '.ps1', '.reg', '.php', '.asp', '.aspx', '.jsp',
  '.dll', '.py', '.elf', '.sh', '.bash', '.wsf', '.vbe', '.jse'
];

// Disk storage engine generating collision-resistant secure filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

// File filter validating extension, MIME type, and blocking dangerous executables
const fileFilter = (req, file, cb) => {
  const originalExt = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  // 1. Explicit dangerous extension detection
  if (DANGEROUS_EXTENSIONS.includes(originalExt)) {
    const err = new Error('Dangerous executable or script uploads are strictly prohibited.');
    err.code = 'LIMIT_FILE_TYPE';
    return cb(err, false);
  }

  // 2. Validate allowed file extension
  if (!ALLOWED_EXTENSIONS.includes(originalExt)) {
    const err = new Error(
      'Unsupported file extension. Allowed formats: JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX, TXT.'
    );
    err.code = 'LIMIT_FILE_TYPE';
    return cb(err, false);
  }

  // 3. Validate allowed MIME type
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    const err = new Error(`Unsupported MIME type (${mime}). Only valid images and documents are accepted.`);
    err.code = 'LIMIT_FILE_TYPE';
    return cb(err, false);
  }

  cb(null, true);
};

// 10 MB maximum upload size limit
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter
});

/**
 * Express middleware wrapper to catch Multer errors and return clean JSON
 */
const handleUpload = (req, res, next) => {
  const singleUpload = upload.single('file');
  singleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File size exceeds the 10MB limit.'
        });
      }
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'File validation failed.'
      });
    }
    next();
  });
};

module.exports = {
  handleUpload,
  uploadDir,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  DANGEROUS_EXTENSIONS,
  MAX_FILE_SIZE
};
