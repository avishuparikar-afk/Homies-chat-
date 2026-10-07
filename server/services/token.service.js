const jwt = require('jsonwebtoken');
const config = require('../config/app.config');

/**
 * Generate a signed JWT for a given user ID
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {string} Signed JWT
 */
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn
  });
};

/**
 * Verify a given JWT token
 * @param {string} token
 * @returns {object} Decoded token payload
 */
const verifyToken = (token) => {
  return jwt.verify(token, config.jwtSecret);
};

module.exports = {
  generateToken,
  verifyToken
};
