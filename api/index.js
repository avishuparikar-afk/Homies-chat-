const mongoose = require('mongoose');
const app = require('../server/server');
const connectDB = require('../server/config/db.config');

let isConnected = false;

module.exports = async (req, res) => {
  // If MongoDB URI is configured in Vercel environment variables, connect once
  if (process.env.MONGODB_URI && mongoose.connection.readyState !== 1) {
    try {
      await connectDB();
      isConnected = true;
    } catch (err) {
      console.warn('[Vercel Serverless] MongoDB connection attempt failed:', err.message);
    }
  }

  return app(req, res);
};
