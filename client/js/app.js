document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Health & Diagnostics
  const serverStatusPill = document.getElementById('server-status-pill');
  const serverStatusText = document.getElementById('server-status-text');
  const serverMsgText = document.getElementById('server-msg-text');
  
  const socketStatusPill = document.getElementById('socket-status-pill');
  const socketStatusText = document.getElementById('socket-status-text');
  const socketIdText = document.getElementById('socket-id-text');
  
  const pingBtn = document.getElementById('ping-btn');
  const refreshHealthBtn = document.getElementById('refresh-health-btn');
  const logContainer = document.getElementById('log-container');

  // DOM Elements - Auth & Session
  const authStatusBadge = document.getElementById('auth-status-badge');
  const unauthView = document.getElementById('unauthenticated-view');
  const authView = document.getElementById('authenticated-view');
  const profileUsername = document.getElementById('profile-username-display');
  const profileEmail = document.getElementById('profile-email-display');
  const profileBio = document.getElementById('profile-bio-display');
  const profileAvatar = document.getElementById('profile-avatar-display');
  const logoutBtn = document.getElementById('logout-btn');

  let socket = null;
  let pingStartTime = 0;

  // Append formatted entry to log box
  const addLog = (message, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    const prefix = `[${time}]`;
    const logLine = `${prefix} [${type.toUpperCase()}] ${message}\n`;
    logContainer.textContent += logLine;
    logContainer.scrollTop = logContainer.scrollHeight;
  };

  // Check User Authentication Session (Phase 2 & 3)
  const checkAuthSession = async () => {
    const token = window.apiService.getToken();
    if (!token) {
      authStatusBadge.className = 'status-pill warning';
      authStatusBadge.innerHTML = '<span class="status-indicator-dot"></span> Guest';
      unauthView.style.display = 'block';
      authView.style.display = 'none';
      addLog('No active session token found (Guest mode).', 'info');
      return;
    }

    try {
      addLog('Validating session token with GET /api/auth/me...', 'info');
      const data = await window.apiService.get('/api/auth/me');

      if (data.success && data.user) {
        window.apiService.setCurrentUser(data.user);
        authStatusBadge.className = 'status-pill success';
        authStatusBadge.innerHTML = '<span class="status-indicator-dot"></span> Authenticated';
        profileUsername.textContent = `@${data.user.username}`;
        profileEmail.textContent = data.user.email;
        profileBio.textContent = data.user.bio || 'Hey there! I am using Real-Time Chat.';
        if (profileAvatar) profileAvatar.textContent = data.user.profileImage || '👤';

        unauthView.style.display = 'none';
        authView.style.display = 'block';
        addLog(`Authenticated successfully as @${data.user.username} (${data.user.email})`, 'success');

        if (window.loadUsersList) {
          window.loadUsersList();
        }
        if (window.loadChatContacts) {
          window.loadChatContacts();
        }
      }
    } catch (error) {
      window.apiService.clearSession();
      authStatusBadge.className = 'status-pill danger';
      authStatusBadge.innerHTML = '<span class="status-indicator-dot"></span> Expired';
      unauthView.style.display = 'block';
      authView.style.display = 'none';
      addLog(`Session token invalid or expired: ${error.message}`, 'warning');
    }
  };

  // Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        addLog('Logging out user via POST /api/auth/logout...', 'info');
        await window.apiService.post('/api/auth/logout', {});
      } catch (e) {
        // Continue clearing client storage regardless
      }
      window.apiService.clearSession();
      addLog('User session terminated.', 'info');
      window.location.reload();
    });
  }

  // Check /api/health API (Phase 1 Preserved)
  const checkHealth = async () => {
    try {
      addLog('Fetching health status from GET /api/health...', 'info');
      serverStatusPill.className = 'status-pill warning';
      serverStatusPill.innerHTML = '<span class="status-indicator-dot"></span> Checking';
      serverStatusText.textContent = 'Contacting server...';

      const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.HEALTH_ENDPOINT}`);
      const data = await response.json();

      if (response.ok && data.success) {
        serverStatusPill.className = 'status-pill success';
        serverStatusPill.innerHTML = '<span class="status-indicator-dot"></span> Online';
        serverStatusText.textContent = 'HTTP 200 OK';
        serverMsgText.textContent = data.message;
        addLog(`Health response: ${JSON.stringify(data)}`, 'success');
      } else {
        throw new Error(data.message || 'Health check failed');
      }
    } catch (error) {
      serverStatusPill.className = 'status-pill danger';
      serverStatusPill.innerHTML = '<span class="status-indicator-dot"></span> Offline';
      serverStatusText.textContent = 'Connection Error';
      serverMsgText.textContent = error.message;
      addLog(`Health check failed: ${error.message}`, 'error');
    }
  };

  // Initialize Socket.IO connection (Phase 1 & 3 with auth token handshake)
  const initSocketConnection = () => {
    if (typeof io === 'undefined') {
      addLog('Socket.IO client library not loaded. Check script tag.', 'error');
      socketStatusPill.className = 'status-pill danger';
      socketStatusPill.innerHTML = '<span class="status-indicator-dot"></span> Error';
      socketStatusText.textContent = 'Library Missing';
      return;
    }

    const token = window.apiService.getToken();
    addLog(`Connecting to Socket.IO server${token ? ' (Authenticated)' : ' (Guest)'}...`, 'info');

    socket = io(CONFIG.SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    window.chatSocket = socket;

    socket.on('connect', () => {
      socketStatusPill.className = 'status-pill success';
      socketStatusPill.innerHTML = '<span class="status-indicator-dot"></span> Connected';
      socketStatusText.textContent = 'WebSocket Active';
      socketIdText.textContent = `Socket ID: ${socket.id}`;
      addLog(`Socket.IO connected successfully! ID: ${socket.id}`, 'success');
    });

    socket.on('disconnect', (reason) => {
      socketStatusPill.className = 'status-pill danger';
      socketStatusPill.innerHTML = '<span class="status-indicator-dot"></span> Disconnected';
      socketStatusText.textContent = 'Disconnected';
      socketIdText.textContent = `Reason: ${reason}`;
      addLog(`Socket.IO disconnected. Reason: ${reason}`, 'warning');
    });

    socket.on('pong', (payload) => {
      const latency = Date.now() - pingStartTime;
      addLog(`Pong received from server! Latency: ${latency}ms (Server time: ${payload.timestamp})`, 'success');
    });

    socket.on('connect_error', (error) => {
      socketStatusPill.className = 'status-pill danger';
      socketStatusPill.innerHTML = '<span class="status-indicator-dot"></span> Error';
      socketStatusText.textContent = 'Connection Error';
      addLog(`Socket connection error: ${error.message}`, 'error');
    });
  };

  // Event Listeners
  refreshHealthBtn.addEventListener('click', () => {
    checkHealth();
  });

  pingBtn.addEventListener('click', () => {
    if (socket && socket.connected) {
      pingStartTime = Date.now();
      addLog('Sending ping event to server...', 'info');
      socket.emit('ping');
    } else {
      addLog('Cannot ping: Socket is not connected', 'warning');
    }
  });

  // Run initial checks
  checkHealth();
  checkAuthSession();
  initSocketConnection();
});
