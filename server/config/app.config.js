require('dotenv').config();

/**
 * Parses and normalizes allowed CORS origins from environment variables.
 */
const parseAllowedOrigins = () => {
  const customOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.trim() : null;
  const defaultDevOrigins = ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:3000'];

  const originsSet = new Set([
    ...(clientUrl ? [clientUrl] : []),
    ...customOrigins,
    ...(process.env.NODE_ENV !== 'production' ? defaultDevOrigins : [])
  ]);

  return Array.from(originsSet);
};

/**
 * Validates critical production configuration when running in production mode.
 */
const validateProductionEnv = () => {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET;

  if (isProd) {
    if (!secret || secret === 'fallback_development_secret_key_12345' || secret.length < 32) {
      console.warn(
        '[Security Warning] In production mode, JWT_SECRET should be explicitly set to a 32+ character secret in environment variables.'
      );
    }
    if (!process.env.MONGODB_URI) {
      console.warn(
        '[Database Warning] In production mode, MONGODB_URI should be set in environment variables (e.g. MongoDB Atlas).'
      );
    }
  }
};

// Validate production settings
validateProductionEnv();

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/realtime_chat_app',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5000',
  allowedOrigins: parseAllowedOrigins(),
  jwtSecret: process.env.JWT_SECRET || 'fallback_development_secret_key_12345',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  socket: {
    pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT, 10) || 20000,
    pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL, 10) || 25000,
    maxHttpBufferSize: parseInt(process.env.SOCKET_MAX_BUFFER_SIZE, 10) || 1e7 // 10MB
  }
};

module.exports = config;
