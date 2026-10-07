const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./config/app.config');
const connectDB = require('./config/db.config');
const initSocket = require('./sockets/socket.init');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const messageRoutes = require('./routes/message.routes');
const groupRoutes = require('./routes/group.routes');
const fileRoutes = require('./routes/file.routes');
const notificationRoutes = require('./routes/notification.routes');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const app = express();

// Security Middlewares (Phase 12 Hardening)
const {
  securityHeaders,
  mongoSanitize,
  apiRateLimiter,
  authRateLimiter,
  uploadRateLimiter
} = require('./middlewares/security.middleware');

app.use(securityHeaders);

// Enable CORS with dynamic allowed origins
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server or tools without origin header
      if (!origin) return callback(null, true);
      if (
        config.allowedOrigins.includes(origin) ||
        config.nodeEnv !== 'production'
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked request from origin: ${origin}`));
    },
    credentials: true
  })
);

// Body Parsing Middlewares
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// NoSQL Injection Query Sanitizer
app.use(mongoSanitize);

// Serve Static Frontend Files
const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

// Global API Rate Limiter
app.use('/api', apiRateLimiter);

// Specific Stricter Limiters
app.use('/api/auth', authRateLimiter);
app.use('/api/files/upload', uploadRateLimiter);

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/notifications', notificationRoutes);

// Catch-all route to serve index.html for frontend single-page navigation
app.get('/', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

// Create HTTP Server & attach Socket.IO
const httpServer = http.createServer(app);
const io = initSocket(httpServer, config);

// Attach io instance to express app for future route access
app.set('io', io);

// Start Server after connecting to Database
const startServer = async () => {
  try {
    await connectDB();

    httpServer.listen(config.port, () => {
      console.log(`=========================================`);
      console.log(`🚀 Server running in ${config.nodeEnv} mode`);
      console.log(`📡 Listening at: http://localhost:${config.port}`);
      console.log(`🩺 Health API: http://localhost:${config.port}/api/health`);
      console.log(`⚡ Socket.IO is initialized and listening`);
      console.log(`=========================================`);
    });
  } catch (error) {
    console.error('Failed to start server due to database connection error:', error.message);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('\nReceived shutdown signal. Closing HTTP server and DB connections...');
  httpServer.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

if (require.main === module) {
  startServer();
}

app.app = app;
app.httpServer = httpServer;
app.startServer = startServer;

module.exports = app;
