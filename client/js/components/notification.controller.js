/**
 * Real-Time Notification Controller
 * Manages notification badge, dropdown, sound chime, browser notifications, and in-app toasts
 */
document.addEventListener('DOMContentLoaded', () => {
  const bellBtn = document.getElementById('notification-bell-btn');
  const unreadBadge = document.getElementById('notification-unread-badge');
  const dropdown = document.getElementById('notification-dropdown');
  const notifList = document.getElementById('notification-list');
  const markAllBtn = document.getElementById('notif-mark-all-btn');
  const soundToggleBtn = document.getElementById('notif-sound-toggle-btn');
  const toastContainer = document.getElementById('notification-toast-container');

  let notifications = [];
  let isSoundEnabled = localStorage.getItem('notificationSoundEnabled') !== 'false';

  // Update sound toggle button appearance
  const updateSoundBtn = () => {
    if (soundToggleBtn) {
      soundToggleBtn.textContent = isSoundEnabled ? '🔊' : '🔇';
      soundToggleBtn.title = isSoundEnabled
        ? 'Notification sound: ON (Click to mute)'
        : 'Notification sound: MUTED (Click to unmute)';
    }
  };
  updateSoundBtn();

  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isSoundEnabled = !isSoundEnabled;
      localStorage.setItem('notificationSoundEnabled', isSoundEnabled);
      updateSoundBtn();
    });
  }

  // Synthesize smooth audio chime using Web Audio API (zero external assets needed)
  const playNotificationSound = () => {
    if (!isSoundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.08); // A5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  };

  // Browser Notification helper
  const showBrowserNotification = (title, body, onClick) => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      const n = new Notification(title, {
        body,
        icon: '/assets/images/default-avatar.png'
      });
      if (onClick) {
        n.onclick = () => {
          window.focus();
          onClick();
          n.close();
        };
      }
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  };

  // Request browser notification permission gently on initial interaction
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    document.addEventListener('click', () => {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }, { once: true });
  }

  // Update total badge counter
  const updateBadge = (count) => {
    if (!unreadBadge) return;
    if (count > 0) {
      unreadBadge.textContent = count > 99 ? '99+' : count;
      unreadBadge.style.display = 'block';
    } else {
      unreadBadge.textContent = '0';
      unreadBadge.style.display = 'none';
    }
  };

  // Render notification list inside dropdown
  const renderNotifications = () => {
    if (!notifList) return;
    if (!notifications || notifications.length === 0) {
      notifList.innerHTML = '<div class="notification-empty">No notifications yet.</div>';
      return;
    }

    notifList.innerHTML = notifications
      .map((notif) => {
        const isUnread = notif.read === false;
        const senderName = notif.sender?.username ? `@${notif.sender.username}` : 'Someone';
        const senderAvatar = notif.sender?.profileImage || '👤';
        const isGroup = notif.type === 'GROUP_MESSAGE';
        const groupName = notif.groupId?.name || 'Group';

        const titleText = isGroup ? `${senderName} in ${groupName}` : `${senderName}`;
        const previewText = notif.message?.text || (notif.message?.fileName ? `📎 ${notif.message.fileName}` : 'sent a message');
        const timeFormatted = window.DateFormatter ? window.DateFormatter.formatTime(notif.createdAt) : '';

        return `
          <div class="notification-item ${isUnread ? 'unread' : ''}" data-notif-id="${notif._id}">
            <div class="notif-avatar">${isGroup ? (notif.groupId?.image || '👥') : senderAvatar}</div>
            <div class="notif-body">
              <div class="notif-title">${titleText}</div>
              <div class="notif-preview">${previewText}</div>
              <div class="notif-time">${timeFormatted}</div>
            </div>
            ${isUnread ? `<button class="notif-read-btn" title="Mark as read" data-notif-read="${notif._id}">✓</button>` : ''}
          </div>
        `;
      })
      .join('');

    // Attach click listeners to notification items
    notifList.querySelectorAll('.notification-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.notif-read-btn')) return;
        const notifId = item.getAttribute('data-notif-id');
        const notif = notifications.find((n) => n._id === notifId);
        if (notif) {
          handleNotificationClick(notif);
        }
      });
    });

    // Attach mark-read button listeners
    notifList.querySelectorAll('.notif-read-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const notifId = btn.getAttribute('data-notif-read');
        markNotificationAsRead(notifId);
      });
    });
  };

  // Fetch notifications from server
  const fetchNotifications = async () => {
    if (!window.apiService?.getToken()) return;
    try {
      const res = await window.apiService.get('/api/notifications');
      if (res.success) {
        notifications = res.notifications || [];
        updateBadge(res.unreadCount || 0);
        renderNotifications();
      }
    } catch (err) {
      // Suppress network errors on initial page load if unauthenticated
    }
  };

  // Mark single notification as read
  const markNotificationAsRead = async (id) => {
    try {
      const res = await window.apiService.put(`/api/notifications/${id}/read`, {});
      if (res.success) {
        const notif = notifications.find((n) => n._id === id);
        if (notif) notif.read = true;
        updateBadge(res.unreadCount || 0);
        renderNotifications();
      }
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      const res = await window.apiService.put('/api/notifications/read-all', {});
      if (res.success) {
        notifications.forEach((n) => (n.read = true));
        updateBadge(0);
        renderNotifications();
      }
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    }
  };

  if (markAllBtn) {
    markAllBtn.addEventListener('click', markAllAsRead);
  }

  // Handle clicking on a notification item: open conversation and mark read
  const handleNotificationClick = (notif) => {
    if (dropdown) dropdown.style.display = 'none';

    if (!notif.read) {
      markNotificationAsRead(notif._id);
    }

    if (notif.type === 'GROUP_MESSAGE' && notif.groupId) {
      // Switch to Groups tab
      const groupsTabBtn = document.getElementById('tab-chats-groups');
      if (groupsTabBtn) groupsTabBtn.click();

      // Trigger click on corresponding group item if rendered
      setTimeout(() => {
        const grpItem = document.querySelector(`[data-group-id="${notif.groupId._id || notif.groupId}"]`);
        if (grpItem) grpItem.click();
      }, 100);
    } else if (notif.sender) {
      // Switch to Direct tab
      const directTabBtn = document.getElementById('tab-chats-direct');
      if (directTabBtn) directTabBtn.click();

      // Trigger click on corresponding contact item
      setTimeout(() => {
        const contactItem = document.querySelector(`[data-user-id="${notif.sender._id || notif.sender}"]`);
        if (contactItem) contactItem.click();
      }, 100);
    }
  };

  // Floating In-App Toast
  const showToast = (title, body, onClick) => {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.innerHTML = `
      <div style="font-size: 1.4rem;">💬</div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin-bottom: 2px;">${title}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${body}</div>
      </div>
      <div style="color: var(--text-dim); font-size: 0.9rem;">✕</div>
    `;

    toast.addEventListener('click', () => {
      toast.remove();
      if (onClick) onClick();
    });

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 250);
    }, 4500);
  };

  // Check if notification is for currently open conversation
  const isCurrentlyOpenConversation = (notif) => {
    const isDirectOpen =
      window.activeChatMode === 'direct' &&
      window.activeContact &&
      (window.activeContact._id === (notif.sender?._id || notif.sender));

    const isGroupOpen =
      window.activeChatMode === 'group' &&
      window.currentActiveGroup &&
      (window.currentActiveGroup._id === (notif.groupId?._id || notif.groupId));

    return Boolean(isDirectOpen || isGroupOpen);
  };

  // Process incoming notification received via Socket.IO
  const handleIncomingNotification = (notif) => {
    // "Do not show notifications for the currently open conversation unnecessarily."
    if (isCurrentlyOpenConversation(notif)) {
      return;
    }

    // Add to notification list
    notifications.unshift(notif);
    const currentCount = parseInt(unreadBadge?.textContent || '0', 10);
    updateBadge(currentCount + 1);
    renderNotifications();

    const isGroup = notif.type === 'GROUP_MESSAGE';
    const senderName = notif.sender?.username ? `@${notif.sender.username}` : 'Someone';
    const groupName = notif.groupId?.name || 'Group';
    const title = isGroup ? `New message in ${groupName}` : `New message from ${senderName}`;
    const preview = notif.message?.text || (notif.message?.fileName ? `📎 ${notif.message.fileName}` : 'sent an attachment');

    // Play chime sound
    playNotificationSound();

    // Show in-app floating toast
    showToast(title, preview, () => handleNotificationClick(notif));

    // Show native browser notification if tab is in background
    if (document.hidden) {
      showBrowserNotification(title, preview, () => handleNotificationClick(notif));
    }
  };

  // Setup Socket.IO listener for new notifications
  const setupNotificationSocket = () => {
    if (!window.chatSocket) {
      setTimeout(setupNotificationSocket, 300);
      return;
    }

    window.chatSocket.off('new-notification').on('new-notification', (notif) => {
      handleIncomingNotification(notif);
    });
  };

  // Toggle Dropdown
  if (bellBtn && dropdown) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.style.display === 'block';
      dropdown.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        fetchNotifications();
      }
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  // Initialize
  fetchNotifications();
  setupNotificationSocket();

  // Expose helpers globally
  window.notificationController = {
    fetchNotifications,
    markNotificationAsRead,
    markAllAsRead,
    playNotificationSound,
    isCurrentlyOpenConversation
  };
});
