document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const userListContainer = document.getElementById('user-list-container');
  const userSearchInput = document.getElementById('user-search-input');
  const userCountBadge = document.getElementById('user-count-badge');
  const editProfileBtn = document.getElementById('edit-profile-btn');
  const viewMyProfileBtn = document.getElementById('view-my-profile-btn');

  // Modals
  const editProfileModal = document.getElementById('edit-profile-modal');
  const viewProfileModal = document.getElementById('view-profile-modal');
  const editProfileForm = document.getElementById('edit-profile-form');
  const editAlertBox = document.getElementById('edit-profile-alert');

  let currentUsersList = [];
  let selectedAvatarIcon = '👤';

  // Open / Close Modal Helpers
  const openModal = (modalEl) => {
    if (modalEl) modalEl.classList.add('open');
  };

  const closeModal = (modalEl) => {
    if (modalEl) modalEl.classList.remove('open');
  };

  document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(editProfileModal);
      closeModal(viewProfileModal);
    });
  });

  // Avatar selector options
  document.querySelectorAll('.avatar-option-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedAvatarIcon = btn.getAttribute('data-avatar');
    });
  });

  const escapeHtml = (text) => {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Render User Card Item
  const createUserItemHTML = (user) => {
    const isOnline = user.online === true;
    const lastSeenText = window.DateFormatter.formatLastSeen(user.lastSeen, isOnline);
    const avatarDisplay = escapeHtml(user.profileImage || '👤');
    const safeUsername = escapeHtml(user.username || '');
    const safeBio = escapeHtml(user.bio || 'Hey there! I am using Homies Chat.');

    return `
      <div class="user-item-card" data-user-id="${user._id}">
        <div class="user-avatar-wrapper">
          <div class="user-avatar-img ${isOnline ? 'has-border' : ''}">
            ${avatarDisplay}
          </div>
          <span class="online-badge-dot ${isOnline ? 'online' : ''}" id="status-dot-${user._id}"></span>
        </div>
        <div class="user-info-col">
          <div class="user-info-header">
            <span class="user-name">@${safeUsername}</span>
            <span class="user-last-seen" id="last-seen-${user._id}">${lastSeenText}</span>
          </div>
          <div class="user-bio-snippet">${safeBio}</div>
        </div>
      </div>
    `;
  };

  // Render User List
  const renderUserList = (users) => {
    if (!userListContainer) return;

    if (!users || users.length === 0) {
      userListContainer.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.9rem;">
          No users found.
        </div>
      `;
      if (userCountBadge) userCountBadge.textContent = '0 users';
      return;
    }

    userListContainer.innerHTML = users.map(createUserItemHTML).join('');
    if (userCountBadge) userCountBadge.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;

    // Attach click handlers to open profile view
    userListContainer.querySelectorAll('.user-item-card').forEach((card) => {
      card.addEventListener('click', () => {
        const userId = card.getAttribute('data-user-id');
        openUserProfile(userId);
      });
    });
  };

  // Fetch Users
  const loadUsers = async () => {
    const token = window.apiService.getToken();
    if (!token) return;

    try {
      const data = await window.apiService.get('/api/users');
      if (data.success) {
        currentUsersList = data.users;
        renderUserList(currentUsersList);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  // Search Users
  let searchTimeout = null;
  if (userSearchInput) {
    userSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();

      searchTimeout = setTimeout(async () => {
        if (!query) {
          renderUserList(currentUsersList);
          return;
        }

        try {
          const data = await window.apiService.get(`/api/users/search?q=${encodeURIComponent(query)}`);
          if (data.success) {
            renderUserList(data.users);
          }
        } catch (err) {
          console.error('Search failed:', err);
        }
      }, 300);
    });
  }

  // Open User Profile Modal
  const openUserProfile = async (userId) => {
    try {
      const data = await window.apiService.get(`/api/users/${userId}`);
      if (data.success && data.user) {
        const u = data.user;
        document.getElementById('view-profile-avatar').textContent = u.profileImage || '👤';
        document.getElementById('view-profile-username').textContent = `@${u.username}`;
        document.getElementById('view-profile-bio').textContent = u.bio || 'No status message provided.';
        document.getElementById('view-profile-email').textContent = u.email;
        document.getElementById('view-profile-status').textContent = u.online ? 'Online' : 'Offline';
        document.getElementById('view-profile-status').style.color = u.online ? '#10b981' : '#94a3b8';
        document.getElementById('view-profile-last-seen').textContent = window.DateFormatter.formatLastSeen(u.lastSeen, u.online);
        document.getElementById('view-profile-joined').textContent = window.DateFormatter.formatFullDate(u.createdAt);

        openModal(viewProfileModal);
      }
    } catch (err) {
      alert(err.message || 'Could not fetch user profile');
    }
  };

  // Open Edit Profile Modal
  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', () => {
      const currentUser = window.apiService.getCurrentUser();
      if (!currentUser) return;

      document.getElementById('edit-username').value = currentUser.username || '';
      document.getElementById('edit-bio').value = currentUser.bio || '';
      selectedAvatarIcon = currentUser.profileImage || '👤';

      document.querySelectorAll('.avatar-option-btn').forEach((b) => {
        if (b.getAttribute('data-avatar') === selectedAvatarIcon) {
          b.classList.add('selected');
        } else {
          b.classList.remove('selected');
        }
      });

      if (editAlertBox) {
        editAlertBox.style.display = 'none';
        editAlertBox.textContent = '';
      }

      openModal(editProfileModal);
    });
  }

  // View My Profile
  if (viewMyProfileBtn) {
    viewMyProfileBtn.addEventListener('click', () => {
      const currentUser = window.apiService.getCurrentUser();
      if (currentUser && currentUser._id) {
        openUserProfile(currentUser._id);
      }
    });
  }

  // Handle Edit Profile Form Submit
  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('edit-username').value.trim();
      const bio = document.getElementById('edit-bio').value.trim();
      const submitBtn = editProfileForm.querySelector('button[type="submit"]');

      if (!username) {
        showEditAlert('Username cannot be empty.');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const res = await window.apiService.put('/api/users/profile', {
          username,
          bio,
          profileImage: selectedAvatarIcon
        });

        if (res.success && res.user) {
          window.apiService.setCurrentUser(res.user);

          // Update header profile display
          const nameEl = document.getElementById('profile-username-display');
          const bioEl = document.getElementById('profile-bio-display');
          const avatarEl = document.getElementById('profile-avatar-display');

          if (nameEl) nameEl.textContent = `@${res.user.username}`;
          if (bioEl) bioEl.textContent = res.user.bio;
          if (avatarEl) avatarEl.textContent = res.user.profileImage || '👤';

          closeModal(editProfileModal);
          loadUsers(); // Refresh list
        }
      } catch (err) {
        showEditAlert(err.message || 'Failed to update profile');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
      }
    });
  }

  const showEditAlert = (msg) => {
    if (editAlertBox) {
      editAlertBox.textContent = msg;
      editAlertBox.className = 'auth-alert error';
      editAlertBox.style.display = 'flex';
    }
  };

  // Socket.IO Real-time presence listener
  if (window.chatSocket) {
    window.chatSocket.on('user:status', (data) => {
      const dot = document.getElementById(`status-dot-${data.userId}`);
      const lastSeen = document.getElementById(`last-seen-${data.userId}`);

      if (dot) {
        if (data.online) {
          dot.classList.add('online');
        } else {
          dot.classList.remove('online');
        }
      }

      if (lastSeen) {
        lastSeen.textContent = window.DateFormatter.formatLastSeen(data.lastSeen, data.online);
      }
    });
  }

  // Load initial list if authenticated
  if (window.apiService.getToken()) {
    loadUsers();
  }

  // Expose loadUsers for external triggers (e.g. login)
  window.loadUsersList = loadUsers;
});
