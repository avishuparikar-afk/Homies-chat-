# Homies Chat — Production Real-Time Chat Application

A modern, production-grade Real-Time Chat Application built with **Node.js**, **Express**, **Socket.IO**, **MongoDB (Mongoose)**, and **Vanilla JavaScript** (Responsive CSS3 / HTML5).

---

## 🚀 Key Features

- **Authentication & Security**:
  - JWT-based authentication with bcrypt password hashing
  - Sliding-window rate limiting (API, Auth, Upload limiters)
  - NoSQL injection protection (`mongoSanitize`)
  - HTTP security headers (`nosniff`, `SAMEORIGIN`, `X-XSS-Protection`)
  - Strict input validation & XSS sanitization
- **Real-Time One-to-One Chat**:
  - Instant WebSocket messaging powered by Socket.IO
  - Offline message queueing & automatic synchronization
  - Real-time typing and stop-typing indicators
  - WhatsApp-style delivery states:
    - `✓` **Sent** (stored on server)
    - `✓✓` **Delivered** (received by client)
    - `✓✓` **Read** (opened by recipient)
- **Group Chat**:
  - Create groups with avatar, description, and member selection
  - Admin controls (add/remove members, update group info)
  - Leave group functionality
  - Real-time group messaging & typing indicators
- **File & Media Sharing**:
  - Secure image upload & inline viewer lightbox (JPG, PNG, WEBP)
  - Document sharing (PDF, DOC, DOCX, TXT)
  - Whitelist validation, 10MB file limit & dangerous executable blocking
  - Private file access authorization (isolated from public web root)
- **Real-Time Notifications**:
  - Unread message counters & notification bell dropdown
  - In-app notification toasts & audio chime support
  - Mark single/all notifications as read
- **Search Engine**:
  - Global message search & in-conversation search
  - User directory & group search
  - Date range filtering & pagination
- **Message Management**:
  - "Delete for me" (excludes message from requester history)
  - "Delete for everyone" (replaces with placeholder and syncs across connected clients)
- **Modern UI & Theming**:
  - Desktop multi-pane shell & Mobile slide navigation
  - Dark Mode & Light Mode support with token persistence
  - Skeleton shimmer loading animations & smooth transitions

---

## 📁 Project Architecture

```text
├── client/                      # Vanilla JS Client
│   ├── css/
│   │   ├── variables.css        # Theming engine & design tokens (Dark/Light)
│   │   ├── base.css             # Resets, modals, skeleton shimmer animations
│   │   └── chat.css             # App shell, responsive layouts, chat bubbles
│   ├── js/
│   │   ├── config.js            # Dynamic API & Socket URL resolution
│   │   ├── app.js               # Bootstrap controller
│   │   ├── services/            # API service (fetch wrapper, JWT storage)
│   │   ├── utils/               # Date & time formatting helpers
│   │   └── components/          # Feature controllers:
│   │       ├── auth.controller.js
│   │       ├── chat.controller.js
│   │       ├── group.controller.js
│   │       ├── file.controller.js
│   │       ├── notification.controller.js
│   │       ├── profile.controller.js
│   │       ├── search.controller.js
│   │       └── theme.controller.js
│   └── index.html               # Single-page application shell
├── server/                      # Node.js / Express Backend
│   ├── config/                  # App & MongoDB configurations
│   ├── controllers/             # REST API business logic
│   ├── middlewares/             # Auth, upload, security, and error handlers
│   ├── models/                  # Mongoose data schemas (User, Message, Group, etc.)
│   ├── routes/                  # Express route definitions
│   ├── services/                # JWT token service
│   ├── sockets/                 # Socket.IO connection & event handlers
│   └── server.js                # Express & HTTP server entry point
├── tests/                       # Automated test suites (Phases 1 - 13)
├── Dockerfile                   # Multi-stage production container
├── .dockerignore                # Docker ignore rules
├── .env.example                 # Environment variables template
└── package.json                 # Scripts and dependencies
```

---

## 🛠️ Quick Start

### 1. Prerequisites
- **Node.js**: v18+ (tested on Node.js v20/v24)
- **MongoDB**: v6.0+ (Local MongoDB or MongoDB Atlas)

### 2. Installation
```bash
git clone https://github.com/avishuparikar-afk/Homies-chat-.git
cd Homies-chat-
npm install
```

### 3. Environment Configuration
Copy the template and supply your values:
```bash
cp .env.example .env
```
Edit `.env`:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/realtime_chat_app
CLIENT_URL=http://localhost:5000
JWT_SECRET=your_super_secret_jwt_key_at_least_32_characters!
JWT_EXPIRES_IN=7d
```

### 4. Run Application
```bash
# Production mode
npm start

# Development mode with hot-reload
npm run dev
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## 🧪 Automated Testing

The codebase includes comprehensive integration and system tests across all features:

```bash
# Run complete test suite
npm test

# Run individual test phases
npm run test:phase12  # Security & Performance audit tests
npm run test:phase13  # Complete E2E integration test suite
```

---

## 🐳 Docker Deployment

```bash
# Build production Docker image
docker build -t homies-chat:latest .

# Run container
docker run -d -p 5000:5000 --env-file .env homies-chat:latest
```

---

## 📜 License
ISC License.
