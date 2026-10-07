# Multi-stage production Dockerfile for Real-Time Chat Application
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose HTTP & WebSocket port
EXPOSE 5000

# Non-root user for security
USER node

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start production server
CMD ["node", "server/server.js"]
