document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const newGroupBtn = document.getElementById('new-group-btn');
  const createGroupModal = document.getElementById('create-group-modal');
  const createGroupForm = document.getElementById('create-group-form');
  const createGroupAlert = document.getElementById('create-group-alert');
  const groupMembersCheckboxList = document.getElementById('group-members-checkbox-list');

  // Group Info Modal Elements
  const groupInfoModal = document.getElementById('group-info-modal');
  const groupInfoBtn = document.getElementById('chat-group-info-btn');
  const groupInfoAvatar = document.getElementById('group-info-avatar');
  const groupInfoName = document.getElementById('group-info-name');
  const groupInfoDesc = document.getElementById('group-info-desc');
  const groupInfoMembersList = document.getElementById('group-info-members-list');
  const addMemberSelect = document.getElementById('group-add-member-select');
  const addMemberBtn = document.getElementById('group-add-member-btn');
  const leaveGroupBtn = document.getElementById('group-leave-btn');
  const addMemberContainer = document.getElementById('group-add-member-container');

  // Groups Scroll Container in Sidebar
  const groupsScroll = document.getElementById('chat-groups-scroll');
  const tabDirectBtn = document.getElementById('tab-chats-direct');
  const tabGroupsBtn = document.getElementById('tab-chats-groups');
  const contactsScroll = document.getElementById('chat-contacts-scroll');

  let activeGroup = null;
  let selectedGroupAvatar = '👥';

  // Modal Open/Close helpers
  const openModal = (m) => m && m.classList.add('open');
  const closeModal = (m) => m && m.classList.remove('open');

  // Sidebar Tab Switching (Direct Chats vs Groups)
  if (tabDirectBtn && tabGroupsBtn) {
    tabDirectBtn.addEventListener('click', () => {
      tabDirectBtn.classList.add('active');
      tabGroupsBtn.classList.remove('active');
      if (contactsScroll) contactsScroll.style.display = 'flex';
      if (groupsScroll) groupsScroll.style.display = 'none';
    });

    tabGroupsBtn.addEventListener('click', () => {
      tabGroupsBtn.classList.add('active');
      tabDirectBtn.classList.remove('active');
      if (contactsScroll) contactsScroll.style.display = 'none';
      if (groupsScroll) groupsScroll.style.display = 'flex';
      loadUserGroups();
    });
  }

  // Group Avatar selector
  document.querySelectorAll('.group-avatar-opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.group-avatar-opt-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedGroupAvatar = btn.getAttribute('data-avatar');
    });
  });

  // Open Create Group Modal
  if (newGroupBtn) {
    newGroupBtn.addEventListener('click', async () => {
      openModal(createGroupModal);
      if (createGroupAlert) createGroupAlert.style.display = 'none';

      // Populate member checkboxes with registered users
      if (groupMembersCheckboxList) {
        groupMembersCheckboxList.innerHTML = '<div style="color: var(--text-dim); font-size: 0.85rem;">Loading contacts...</div>';
        try {
          const res = await window.apiService.get('/api/users');
          if (res.success && res.users.length > 0) {
            groupMembersCheckboxList.innerHTML = res.users
              .map(
                (u) => `
                <label style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; cursor: pointer; padding: 0.35rem 0;">
                  <input type="checkbox" name="group-member-cb" value="${u._id}">
                  <span>${u.profileImage || '👤'} @${u.username}</span>
                </label>
              `
              )
              .join('');
          } else {
            groupMembersCheckboxList.innerHTML = '<div style="color: var(--text-dim); font-size: 0.85rem;">No contacts available.</div>';
          }
        } catch (e) {
          groupMembersCheckboxList.innerHTML = '<div style="color: #f87171; font-size: 0.85rem;">Failed to load contacts.</div>';
        }
      }
    });
  }

  // Create Group Form Submit
  if (createGroupForm) {
    createGroupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('create-group-name').value.trim();
      const desc = document.getElementById('create-group-desc').value.trim();
      const submitBtn = createGroupForm.querySelector('button[type="submit"]');

      if (!name) return;

      const checkedBoxes = Array.from(document.querySelectorAll('input[name="group-member-cb"]:checked'));
      const memberIds = checkedBoxes.map((cb) => cb.value);

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        const res = await window.apiService.post('/api/groups', {
          name,
          description: desc,
          image: selectedGroupAvatar,
          members: memberIds
        });

        if (res.success && res.group) {
          closeModal(createGroupModal);
          createGroupForm.reset();
          loadUserGroups();
          openGroupConversation(res.group);
        }
      } catch (err) {
        if (createGroupAlert) {
          createGroupAlert.textContent = err.message || 'Failed to create group';
          createGroupAlert.className = 'auth-alert error';
          createGroupAlert.style.display = 'flex';
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Group';
      }
    });
  }

  // Fetch and Render User Groups
  const loadUserGroups = async () => {
    const token = window.apiService.getToken();
    if (!token || !groupsScroll) return;

    if (typeof window.showSidebarSkeleton === 'function') {
      window.showSidebarSkeleton(groupsScroll, 4);
    }

    try {
      const res = await window.apiService.get('/api/groups');
      if (res.success) {
        renderGroupsList(res.groups);
      }
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  };

  const renderGroupsList = (groups) => {
    if (!groupsScroll) return;

    if (!groups || groups.length === 0) {
      groupsScroll.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-dim); font-size: 0.85rem;">
          No groups yet. Click "New Group" above to start one!
        </div>
      `;
      return;
    }

    groupsScroll.innerHTML = groups
      .map((g) => {
        const isActive = activeGroup && activeGroup._id === g._id;
        return `
          <div class="contact-card-item ${isActive ? 'active' : ''}" data-group-id="${g._id}">
            <div class="user-avatar-wrapper">
              <div class="user-avatar-img" style="font-size: 1.3rem;">
                ${g.image || '👥'}
              </div>
            </div>
            <div class="user-info-col">
              <div class="user-info-header">
                <span class="user-name">${g.name}</span>
                <span class="user-last-seen">${g.members?.length || 0} members</span>
              </div>
              <div class="user-bio-snippet">${g.description || 'No description'}</div>
            </div>
          </div>
        `;
      })
      .join('');

    groupsScroll.querySelectorAll('.contact-card-item').forEach((item) => {
      item.addEventListener('click', () => {
        const gId = item.getAttribute('data-group-id');
        const grp = groups.find((g) => g._id === gId);
        if (grp) openGroupConversation(grp);
      });
    });
  };

  // Open Group Conversation
  const openGroupConversation = async (group) => {
    activeGroup = group;
    window.activeChatMode = 'group';
    window.currentActiveGroup = group;

    // Join room via socket
    if (window.chatSocket && window.chatSocket.connected) {
      window.chatSocket.emit('join-group', { groupId: group._id });
    }

    // Highlight active item
    document.querySelectorAll('#chat-groups-scroll .contact-card-item').forEach((el) => {
      if (el.getAttribute('data-group-id') === group._id) el.classList.add('active');
      else el.classList.remove('active');
    });

    // Update Header
    const chatLayout = document.getElementById('chat-layout-container');
    const headerAvatar = document.getElementById('chat-header-avatar');
    const headerUsername = document.getElementById('chat-header-username');
    const headerStatusDot = document.getElementById('chat-header-status-dot');
    const headerStatusSub = document.getElementById('chat-header-status-sub');
    const chatEmptyView = document.getElementById('chat-empty-view');
    const chatActiveView = document.getElementById('chat-active-view');
    const groupInfoToggleBtn = document.getElementById('chat-group-info-btn');

    if (headerAvatar) headerAvatar.textContent = group.image || '👥';
    if (headerUsername) headerUsername.textContent = group.name;
    if (headerStatusDot) headerStatusDot.style.display = 'none';
    if (headerStatusSub) {
      headerStatusSub.textContent = `${group.members?.length || 0} members`;
      headerStatusSub.className = 'chat-header-status-sub';
    }
    if (groupInfoToggleBtn) groupInfoToggleBtn.style.display = 'inline-flex';

    if (chatEmptyView) chatEmptyView.style.display = 'none';
    if (chatActiveView) chatActiveView.style.display = 'flex';
    if (chatLayout) chatLayout.classList.add('mobile-chat-open');

    const appShell = document.getElementById('app-shell');
    if (appShell) appShell.classList.add('mobile-chat-open');

    // Fetch Group Messages
    const stream = document.getElementById('chat-messages-stream');
    try {
      if (typeof window.showMessagesSkeleton === 'function' && stream) {
        window.showMessagesSkeleton(stream);
      } else if (stream) {
        stream.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.85rem;">Loading group messages...</div>';
      }

      const res = await window.apiService.get(`/api/groups/${group._id}/messages`);
      stream.innerHTML = '';

      if (res.success && res.messages.length > 0) {
        res.messages.forEach((m) => {
          stream.appendChild(renderGroupBubble(m));
        });
      } else {
        stream.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.85rem;">No messages in ${group.name} yet. Send the first message!</div>`;
      }

      stream.scrollTop = stream.scrollHeight;
      document.getElementById('chat-message-input')?.focus();
    } catch (err) {
      stream.innerHTML = `<div style="text-align: center; padding: 2rem; color: #f87171; font-size: 0.85rem;">Failed to load messages: ${err.message}</div>`;
    }
  };

  const renderGroupBubble = (msg) => {
    const currentUser = window.apiService.getCurrentUser();
    const isSent = (msg.sender?._id || msg.sender) === currentUser?._id;
    const senderName = msg.sender?.username ? `@${msg.sender.username}` : '';
    const timeFormatted = window.DateFormatter.formatTime(msg.createdAt || new Date());
    const hasAttachment = Boolean(msg.fileUrl || msg.fileName);
    const showText = msg.text && msg.text !== msg.fileName;
    const attachmentHTML = window.renderAttachmentHTML ? window.renderAttachmentHTML(msg) : '';

    const bubbleRow = document.createElement('div');
    bubbleRow.className = `message-bubble-row ${isSent ? 'sent' : 'received'}`;
    bubbleRow.id = `msg-${msg._id}`;

    if (msg.isDeletedForEveryone) {
      bubbleRow.innerHTML = `
        <div class="chat-bubble ${isSent ? 'sent' : 'received'} deleted">
          ${!isSent ? `<div style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.2rem;">${senderName}</div>` : ''}
          <div class="chat-bubble-text">🚫 This message was deleted</div>
          <div class="chat-bubble-footer">
            <span>${timeFormatted}</span>
          </div>
        </div>
      `;
      return bubbleRow;
    }

    bubbleRow.innerHTML = `
      <div class="chat-bubble ${isSent ? 'sent' : 'received'}">
        ${!isSent ? `<div style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.2rem;">${senderName}</div>` : ''}
        ${hasAttachment ? attachmentHTML : ''}
        ${showText ? `<div class="chat-bubble-text">${escapeHtml(msg.text)}</div>` : ''}
        <div class="chat-bubble-footer">
          <span>${timeFormatted}</span>
          ${isSent ? `<span class="status-tick sent" title="Sent">✓</span>` : ''}
        </div>
      </div>
      <button class="msg-delete-btn" type="button" title="Delete message">🗑️</button>
    `;

    const delBtn = bubbleRow.querySelector('.msg-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isGroupAdmin = Boolean(
          activeGroup &&
          activeGroup.admins?.some((a) => (a._id || a).toString() === currentUser?._id.toString())
        );
        if (typeof window.openDeleteModal === 'function') {
          window.openDeleteModal(msg._id, isSent, isGroupAdmin);
        }
      });
    }

    const imgPreview = bubbleRow.querySelector('.chat-media-preview-wrap');
    if (imgPreview) {
      imgPreview.addEventListener('click', () => {
        const vUrl = imgPreview.getAttribute('data-view-url');
        const sName = imgPreview.getAttribute('data-safe-name');
        const sSize = imgPreview.getAttribute('data-size');
        window.openImageLightbox(vUrl, sName, sSize);
      });
    }

    return bubbleRow;
  };

  const escapeHtml = (text) => {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Open Group Info Modal
  if (groupInfoBtn) {
    groupInfoBtn.addEventListener('click', async () => {
      if (!activeGroup) return;

      try {
        const res = await window.apiService.get(`/api/groups/${activeGroup._id}`);
        if (res.success && res.group) {
          activeGroup = res.group;
          renderGroupInfoModal(res.group);
          openModal(groupInfoModal);
        }
      } catch (err) {
        alert(err.message || 'Failed to fetch group details');
      }
    });
  }

  const renderGroupInfoModal = async (group) => {
    const currentUser = window.apiService.getCurrentUser();
    const isAdmin = group.admins.some((a) => (a._id || a).toString() === currentUser?._id.toString());

    groupInfoAvatar.textContent = group.image || '👥';
    groupInfoName.textContent = group.name;
    groupInfoDesc.textContent = group.description || 'No description provided.';

    // Members list
    groupInfoMembersList.innerHTML = group.members
      .map((m) => {
        const mAdmin = group.admins.some((a) => (a._id || a).toString() === m._id.toString());
        const isSelf = m._id.toString() === currentUser?._id.toString();

        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span>${m.profileImage || '👤'}</span>
              <span style="font-weight: 600; font-size: 0.9rem;">@${m.username} ${isSelf ? '(You)' : ''}</span>
              ${mAdmin ? '<span class="status-pill warning" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">Admin</span>' : ''}
            </div>
            ${isAdmin && !isSelf ? `
              <button class="btn btn-outline remove-member-btn" data-user-id="${m._id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-color: #ef4444; color: #ef4444;">
                Remove
              </button>
            ` : ''}
          </div>
        `;
      })
      .join('');

    // Attach Remove Member buttons
    groupInfoMembersList.querySelectorAll('.remove-member-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const uId = btn.getAttribute('data-user-id');
        if (confirm('Remove this member from the group?')) {
          try {
            const res = await window.apiService.delete(`/api/groups/${group._id}/members/${uId}`);
            if (res.success) {
              activeGroup = res.group;
              renderGroupInfoModal(res.group);
              loadUserGroups();
            }
          } catch (err) {
            alert(err.message || 'Failed to remove member');
          }
        }
      });
    });

    // Add Member section (visible to Admins)
    if (addMemberContainer) {
      if (isAdmin) {
        addMemberContainer.style.display = 'block';
        // Populate dropdown with users not yet in group
        try {
          const allUsersRes = await window.apiService.get('/api/users');
          if (allUsersRes.success) {
            const nonMembers = allUsersRes.users.filter(
              (u) => !group.members.some((m) => (m._id || m).toString() === u._id.toString())
            );

            addMemberSelect.innerHTML = nonMembers.length
              ? nonMembers.map((u) => `<option value="${u._id}">@${u.username}</option>`).join('')
              : '<option disabled>All users already in group</option>';
            addMemberBtn.disabled = nonMembers.length === 0;
          }
        } catch (e) {}
      } else {
        addMemberContainer.style.display = 'none';
      }
    }
  };

  // Add Member Button Click
  if (addMemberBtn) {
    addMemberBtn.addEventListener('click', async () => {
      if (!activeGroup) return;
      const targetUserId = addMemberSelect.value;
      if (!targetUserId) return;

      try {
        const res = await window.apiService.post(`/api/groups/${activeGroup._id}/members`, { userId: targetUserId });
        if (res.success) {
          activeGroup = res.group;
          renderGroupInfoModal(res.group);
          loadUserGroups();
        }
      } catch (err) {
        alert(err.message || 'Failed to add member');
      }
    });
  }

  // Leave Group Button
  if (leaveGroupBtn) {
    leaveGroupBtn.addEventListener('click', async () => {
      if (!activeGroup) return;
      const currentUser = window.apiService.getCurrentUser();
      if (!currentUser) return;

      if (confirm(`Are you sure you want to leave ${activeGroup.name}?`)) {
        try {
          const res = await window.apiService.delete(`/api/groups/${activeGroup._id}/members/${currentUser._id}`);
          if (res.success) {
            closeModal(groupInfoModal);
            activeGroup = null;
            window.activeChatMode = 'direct';
            document.getElementById('chat-empty-view').style.display = 'flex';
            document.getElementById('chat-active-view').style.display = 'none';
            loadUserGroups();
          }
        } catch (err) {
          alert(err.message || 'Failed to leave group');
        }
      }
    });
  }

  // Real-time Group Socket Listeners
  const setupGroupSocketListeners = () => {
    if (!window.chatSocket) {
      setTimeout(setupGroupSocketListeners, 300);
      return;
    }

    const socket = window.chatSocket;

    socket.off('group-message').on('group-message', (msg) => {
      if (window.activeChatMode === 'group' && activeGroup && msg.groupId === activeGroup._id) {
        const stream = document.getElementById('chat-messages-stream');
        if (stream) {
          const emptyMsg = stream.querySelector('div[style*="text-align: center"]');
          if (emptyMsg) emptyMsg.remove();

          const typingIndicator = document.getElementById('chat-typing-indicator');
          if (typingIndicator) typingIndicator.style.display = 'none';

          stream.appendChild(renderGroupBubble(msg));
          stream.scrollTop = stream.scrollHeight;
        }
      }
    });

    socket.off('group-typing').on('group-typing', (data) => {
      if (window.activeChatMode === 'group' && activeGroup && data.groupId === activeGroup._id) {
        const sub = document.getElementById('chat-header-status-sub');
        const typingIndicator = document.getElementById('chat-typing-indicator');
        if (sub) {
          sub.textContent = `@${data.username} is typing...`;
          sub.classList.add('typing-active');
        }
        if (typingIndicator) {
          typingIndicator.style.display = 'inline-flex';
        }
      }
    });

    socket.off('group-stop-typing').on('group-stop-typing', (data) => {
      if (window.activeChatMode === 'group' && activeGroup && data.groupId === activeGroup._id) {
        const sub = document.getElementById('chat-header-status-sub');
        const typingIndicator = document.getElementById('chat-typing-indicator');
        if (sub) {
          sub.textContent = `${activeGroup.members?.length || 0} members`;
          sub.className = 'chat-header-status-sub';
        }
        if (typingIndicator) {
          typingIndicator.style.display = 'none';
        }
      }
    });

    socket.off('group-created').on('group-created', () => {
      loadUserGroups();
    });

    socket.off('message-deleted').on('message-deleted', (data) => {
      if (data && data.messageId && typeof window.applyMessageDeletedUI === 'function') {
        window.applyMessageDeletedUI(data.messageId, data.type || 'everyone');
      }
    });
  };

  // Expose loadUserGroups globally
  window.loadUserGroups = loadUserGroups;

  // Initialize
  if (window.apiService.getToken()) {
    loadUserGroups();
  }

  setupGroupSocketListeners();
});
