/**
 * Security & Protection Middlewares
 * Phase 12: Security & Performance Hardening
 */

// --- 1. NoSQL Injection Query Sanitizer ---
/**
 * Recursively removes any keys starting with '$' or containing '.' from objects.
 * Prevents NoSQL operator injection in req.body, req.query, and req.params.
 */
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const clean = {};
  for (const key of Object.keys(obj)) {
    // Block operator keys starting with '$' or containing '.'
    if (key.startsWith('$') || key.includes('.')) {
      continue;
    }
    const val = obj[key];
    clean[key] = typeof val === 'object' && val !== null ? sanitizeObject(val) : val;
  }
  return clean;
};

const mongoSanitize = (req, res, next) => {
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);
  next();
};

// --- 2. HTTP Security Headers ---
/**
 * Applies essential security headers to protect against Clickjacking,
 * MIME-sniffing, and cross-site leaks.
 */
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

// --- 3. In-Memory Sliding Window Rate Limiter ---
/**
 * Lightweight, high-performance in-memory rate limiter without external dependencies.
 * Automatically cleans up expired windows.
 */
const createRateLimiter = ({ windowMs = 60 * 1000, max = 100, message = 'Too many requests, please try again later.' }) => {
  const hits = new Map();

  // Periodic garbage collection every 2 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, 2 * 60 * 1000);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req, res, next) => {
    // Identify client by IP (or X-Forwarded-For if behind reverse proxy)
    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown-ip';

    const now = Date.now();
    let record = hits.get(clientIp);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs
      };
      hits.set(clientIp, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        success: false,
        message,
        retryAfter: retryAfterSeconds
      });
    }

    next();
  };
};

const isTestEnv = process.env.NODE_ENV === 'test';

// Global API Limiter: 400 requests per minute per IP
const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: isTestEnv ? 5000 : 400,
  message: 'Too many requests from this IP, please try again after a minute.'
});

// Stricter Auth Limiter: 30 requests per minute per IP to protect against brute-force
const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: isTestEnv ? 1000 : 30,
  message: 'Too many authentication attempts, please try again after a minute.'
});

// File Upload Limiter: 40 uploads per minute per IP
const uploadRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: isTestEnv ? 500 : 40,
  message: 'Upload rate limit reached, please wait a minute before uploading again.'
});

module.exports = {
  mongoSanitize,
  securityHeaders,
  createRateLimiter,
  apiRateLimiter,
  authRateLimiter,
  uploadRateLimiter
};
