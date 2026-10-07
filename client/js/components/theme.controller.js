/**
 * Theme & UI Controller (Phase 11 Redesign)
 * Manages Dark/Light Mode, Profile Dropdown Menu, Settings Modal & Skeleton Loaders
 */
document.addEventListener('DOMContentLoaded', () => {
  // Theme Toggle Elements
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeToggleIcon = document.getElementById('theme-toggle-icon');

  // Profile Menu Dropdown Elements
  const profileMenuBtn = document.getElementById('profile-menu-btn');
  const sidebarUserMenuBtn = document.getElementById('sidebar-user-menu-btn');
  const profileDropdown = document.getElementById('profile-dropdown-menu');
  const menuViewProfileBtn = document.getElementById('menu-view-profile-btn');
  const menuEditProfileBtn = document.getElementById('menu-edit-profile-btn');
  const menuSettingsBtn = document.getElementById('menu-settings-btn');
  const menuLogoutBtn = document.getElementById('menu-logout-btn');

  // Settings Modal Elements
  const settingsModal = document.getElementById('settings-modal');
  const settingsModalCloseBtn = document.getElementById('settings-modal-close-btn');
  const openSettingsShortcut = document.getElementById('open-settings-shortcut');
  const settingsTabAppearance = document.getElementById('settings-tab-appearance');
  const settingsTabDiagnostics = document.getElementById('settings-tab-diagnostics');
  const settingsTabAccount = document.getElementById('settings-tab-account');
  const settingsPaneAppearance = document.getElementById('settings-pane-appearance');
  const settingsPaneDiagnostics = document.getElementById('settings-pane-diagnostics');
  const settingsPaneAccount = document.getElementById('settings-pane-account');

  const themeRadioDark = document.getElementById('theme-radio-dark');
  const themeRadioLight = document.getElementById('theme-radio-light');
  const settingsSoundToggle = document.getElementById('settings-sound-toggle');

  // Quick Action Buttons on Empty State
  const emptyStartChatBtn = document.getElementById('empty-start-chat-btn');
  const emptySearchBtn = document.getElementById('empty-search-btn');

  /* ==========================================================================
     1. Theme Engine (Dark / Light Mode)
     ========================================================================== */
  const getPreferredTheme = () => {
    const saved = localStorage.getItem('app-theme');
    if (saved) return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };

  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);

    if (themeToggleIcon) {
      themeToggleIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
    }

    if (themeRadioDark && themeRadioLight) {
      themeRadioDark.checked = theme === 'dark';
      themeRadioLight.checked = theme === 'light';
    }
  };

  // Initialize Theme
  applyTheme(getPreferredTheme());

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  if (themeRadioDark) {
    themeRadioDark.addEventListener('change', () => {
      if (themeRadioDark.checked) applyTheme('dark');
    });
  }

  if (themeRadioLight) {
    themeRadioLight.addEventListener('change', () => {
      if (themeRadioLight.checked) applyTheme('light');
    });
  }

  /* ==========================================================================
     2. Profile Dropdown Menu
     ========================================================================== */
  const toggleProfileDropdown = (e) => {
    e?.stopPropagation();
    if (!profileDropdown) return;
    const isVisible = profileDropdown.style.display !== 'none';
    profileDropdown.style.display = isVisible ? 'none' : 'block';
  };

  const closeProfileDropdown = () => {
    if (profileDropdown) profileDropdown.style.display = 'none';
  };

  if (profileMenuBtn) profileMenuBtn.addEventListener('click', toggleProfileDropdown);
  if (sidebarUserMenuBtn) sidebarUserMenuBtn.addEventListener('click', toggleProfileDropdown);

  document.addEventListener('click', (e) => {
    if (profileDropdown && !profileDropdown.contains(e.target) && e.target !== profileMenuBtn && e.target !== sidebarUserMenuBtn) {
      closeProfileDropdown();
    }
  });

  if (menuViewProfileBtn) {
    menuViewProfileBtn.addEventListener('click', () => {
      closeProfileDropdown();
      document.getElementById('view-my-profile-btn')?.click();
    });
  }

  if (menuEditProfileBtn) {
    menuEditProfileBtn.addEventListener('click', () => {
      closeProfileDropdown();
      document.getElementById('edit-profile-btn')?.click();
    });
  }

  if (menuSettingsBtn) {
    menuSettingsBtn.addEventListener('click', () => {
      closeProfileDropdown();
      openSettingsModal();
    });
  }

  if (menuLogoutBtn) {
    menuLogoutBtn.addEventListener('click', () => {
      closeProfileDropdown();
      document.getElementById('logout-btn')?.click();
    });
  }

  /* ==========================================================================
     3. Settings Modal & Diagnostics Matrix
     ========================================================================== */
  const openSettingsModal = () => {
    if (!settingsModal) return;
    settingsModal.style.display = 'flex';
    settingsModal.classList.add('open');

    // Update settings account preview
    const currentUser = window.apiService?.getCurrentUser();
    if (currentUser) {
      const nameEl = document.getElementById('settings-acc-username');
      const emailEl = document.getElementById('settings-acc-email');
      const bioEl = document.getElementById('settings-acc-bio');
      const avatarEl = document.getElementById('settings-acc-avatar');
      if (nameEl) nameEl.textContent = `@${currentUser.username}`;
      if (emailEl) emailEl.textContent = currentUser.email;
      if (bioEl) bioEl.textContent = currentUser.bio || 'Available';
      if (avatarEl) avatarEl.textContent = currentUser.profileImage || '👤';
    }
  };

  const closeSettingsModal = () => {
    if (!settingsModal) return;
    settingsModal.style.display = 'none';
    settingsModal.classList.remove('open');
  };

  if (settingsModalCloseBtn) settingsModalCloseBtn.addEventListener('click', closeSettingsModal);
  if (openSettingsShortcut) openSettingsShortcut.addEventListener('click', openSettingsModal);

  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  // Settings Tabs Switcher
  const switchSettingsTab = (tab) => {
    [settingsTabAppearance, settingsTabDiagnostics, settingsTabAccount].forEach((t) => t?.classList.remove('active'));
    [settingsPaneAppearance, settingsPaneDiagnostics, settingsPaneAccount].forEach((p) => {
      if (p) p.style.display = 'none';
    });

    if (tab === 'appearance') {
      settingsTabAppearance?.classList.add('active');
      if (settingsPaneAppearance) settingsPaneAppearance.style.display = 'block';
    } else if (tab === 'diagnostics') {
      settingsTabDiagnostics?.classList.add('active');
      if (settingsPaneDiagnostics) settingsPaneDiagnostics.style.display = 'block';
    } else if (tab === 'account') {
      settingsTabAccount?.classList.add('active');
      if (settingsPaneAccount) settingsPaneAccount.style.display = 'block';
    }
  };

  if (settingsTabAppearance) settingsTabAppearance.addEventListener('click', () => switchSettingsTab('appearance'));
  if (settingsTabDiagnostics) settingsTabDiagnostics.addEventListener('click', () => switchSettingsTab('diagnostics'));
  if (settingsTabAccount) settingsTabAccount.addEventListener('click', () => switchSettingsTab('account'));

  // Notification Sound setting sync
  if (settingsSoundToggle) {
    settingsSoundToggle.checked = localStorage.getItem('chat_notif_sound') !== 'disabled';
    settingsSoundToggle.addEventListener('change', () => {
      if (settingsSoundToggle.checked) {
        localStorage.setItem('chat_notif_sound', 'enabled');
      } else {
        localStorage.setItem('chat_notif_sound', 'disabled');
      }
      const bellSoundBtn = document.getElementById('notif-sound-toggle-btn');
      if (bellSoundBtn) {
        bellSoundBtn.textContent = settingsSoundToggle.checked ? '🔊' : '🔇';
      }
    });
  }

  // Quick Action Buttons on Empty State
  if (emptyStartChatBtn) {
    emptyStartChatBtn.addEventListener('click', () => {
      document.getElementById('tab-chats-direct')?.click();
      const firstContact = document.querySelector('#chat-contacts-scroll .contact-card-item');
      if (firstContact) firstContact.click();
      else alert('Select a contact from the sidebar or click Explore to find users.');
    });
  }

  if (emptySearchBtn) {
    emptySearchBtn.addEventListener('click', () => {
      document.getElementById('global-search-btn')?.click();
    });
  }

  /* ==========================================================================
     4. Skeleton Loader Generators
     ========================================================================== */
  const showContactsSkeleton = (container, count = 5) => {
    if (!container) return;
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="skeleton-contact-card">
          <div class="skeleton skeleton-avatar"></div>
          <div class="skeleton-text-col">
            <div class="skeleton skeleton-line title"></div>
            <div class="skeleton skeleton-line sub"></div>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  };

  const showMessagesSkeleton = (container, count = 4) => {
    if (!container) return;
    let html = '';
    for (let i = 0; i < count; i++) {
      const isSent = i % 2 === 1;
      html += `
        <div class="message-bubble-row ${isSent ? 'sent' : 'received'}">
          <div class="skeleton" style="width: ${180 + (i * 25) % 100}px; height: 42px; border-radius: 12px;"></div>
        </div>
      `;
    }
    container.innerHTML = html;
  };

  window.showContactsSkeleton = showContactsSkeleton;
  window.showMessagesSkeleton = showMessagesSkeleton;

  // Sync user meta to sidebar top pill
  const updateSidebarUserPill = () => {
    const currentUser = window.apiService?.getCurrentUser();
    const avatarEl = document.getElementById('sidebar-my-avatar');
    const nameEl = document.getElementById('sidebar-my-username');
    const statusEl = document.getElementById('sidebar-my-status');
    const dotEl = document.getElementById('sidebar-my-status-dot');

    if (currentUser) {
      if (avatarEl) avatarEl.textContent = currentUser.profileImage || '👤';
      if (nameEl) nameEl.textContent = `@${currentUser.username}`;
      if (statusEl) statusEl.textContent = 'Online';
      if (dotEl) dotEl.className = 'online-indicator-dot online';
    } else {
      if (avatarEl) avatarEl.textContent = '👤';
      if (nameEl) nameEl.textContent = 'Guest';
      if (statusEl) statusEl.textContent = 'Sign In';
      if (dotEl) dotEl.className = 'online-indicator-dot';
    }
  };

  setTimeout(updateSidebarUserPill, 400);

  // Tab Switcher between Direct, Groups, and Explore Directory
  const tabDirect = document.getElementById('tab-chats-direct');
  const tabGroups = document.getElementById('tab-chats-groups');
  const tabExplore = document.getElementById('tab-community-dir');

  const contactsScroll = document.getElementById('chat-contacts-scroll');
  const groupsScroll = document.getElementById('chat-groups-scroll');
  const explorePane = document.getElementById('community-directory-pane');

  if (tabExplore) {
    tabExplore.addEventListener('click', () => {
      [tabDirect, tabGroups, tabExplore].forEach((t) => t?.classList.remove('active'));
      tabExplore.classList.add('active');

      if (contactsScroll) contactsScroll.style.display = 'none';
      if (groupsScroll) groupsScroll.style.display = 'none';
      if (explorePane) explorePane.style.display = 'flex';

      if (typeof window.loadUsersList === 'function') {
        window.loadUsersList();
      }
    });
  }

  if (tabDirect && contactsScroll && explorePane) {
    tabDirect.addEventListener('click', () => {
      if (explorePane) explorePane.style.display = 'none';
    });
  }

  if (tabGroups && groupsScroll && explorePane) {
    tabGroups.addEventListener('click', () => {
      if (explorePane) explorePane.style.display = 'none';
    });
  }
});
