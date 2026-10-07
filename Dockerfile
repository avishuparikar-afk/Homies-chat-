# Multi-stage production Dockerfile for Homies Chat Application
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies cleanly without dev dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose HTTP & WebSocket port
EXPOSE 5000

# Non-root user for security
USER node

# Start production server
CMD ["node", "server/server.js"]
