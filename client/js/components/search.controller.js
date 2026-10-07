/**
 * Search Controller (Phase 9)
 * Handles In-Conversation Search and Global Search Hub across Messages, Users, and Groups.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Elements - In-Chat Search
  const inChatSearchBtn = document.getElementById('in-chat-search-btn');
  const inChatSearchBar = document.getElementById('in-chat-search-bar');
  const inChatSearchInput = document.getElementById('in-chat-search-input');
  const inChatSearchDate = document.getElementById('in-chat-search-date');
  const inChatSearchCount = document.getElementById('in-chat-search-count');
  const inChatSearchPrevBtn = document.getElementById('in-chat-search-prev-btn');
  const inChatSearchNextBtn = document.getElementById('in-chat-search-next-btn');
  const inChatSearchCloseBtn = document.getElementById('in-chat-search-close-btn');

  // Elements - Global Search Modal
  const globalSearchBtn = document.getElementById('global-search-btn');
  const searchModal = document.getElementById('search-modal');
  const searchModalCloseBtn = document.getElementById('search-modal-close-btn');
  const searchTabMessages = document.getElementById('search-tab-messages');
  const searchTabUsers = document.getElementById('search-tab-users');
  const searchTabGroups = document.getElementById('search-tab-groups');
  const searchMainInput = document.getElementById('search-main-input');
  const searchExecuteBtn = document.getElementById('search-execute-btn');
  const searchMsgFilters = document.getElementById('search-msg-filters');
  const searchConvFilter = document.getElementById('search-conversation-filter');
  const searchStartDate = document.getElementById('search-start-date');
  const searchEndDate = document.getElementById('search-end-date');
  const searchResetFiltersBtn = document.getElementById('search-reset-filters-btn');
  const searchResultsList = document.getElementById('search-results-list');
  const searchPaginationBar = document.getElementById('search-pagination-bar');
  const searchPrevBtn = document.getElementById('search-prev-btn');
  const searchNextBtn = document.getElementById('search-next-btn');
  const searchPageIndicator = document.getElementById('search-page-indicator');

  // State
  let inChatPage = 1;
  let inChatTotalPages = 1;
  let inChatTimeout = null;

  let currentSearchTab = 'messages'; // 'messages' | 'users' | 'groups'
  let globalSearchPage = 1;
  let globalTotalPages = 1;
  let globalTotalCount = 0;

  // Escape HTML helper
  const escapeHtml = (text) => {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Safe Highlight text helper
  const highlightMatch = (text, query) => {
    if (!text) return '';
    const safeText = escapeHtml(text);
    if (!query || !query.trim()) return safeText;

    const escapedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return safeText.replace(regex, '<mark class="search-highlight">$1</mark>');
  };

  /* ==========================================================================
     In-Conversation Search
     ========================================================================== */

  const toggleInChatSearchBar = () => {
    if (!inChatSearchBar) return;
    const isVisible = inChatSearchBar.style.display !== 'none';
    if (isVisible) {
      closeInChatSearch();
    } else {
      inChatSearchBar.style.display = 'flex';
      inChatSearchInput.focus();
    }
  };

  const closeInChatSearch = () => {
    if (!inChatSearchBar) return;
    inChatSearchBar.style.display = 'none';
    inChatSearchInput.value = '';
    inChatSearchDate.value = '';
    inChatSearchCount.textContent = '';
    inChatSearchPrevBtn.disabled = true;
    inChatSearchNextBtn.disabled = true;
    inChatPage = 1;

    // Reload conversation messages to restore full stream
    if (window.activeChatMode === 'group' && window.currentActiveGroup) {
      // Re-open active group
      if (typeof window.loadUserGroups === 'function') {
        const stream = document.getElementById('chat-messages-stream');
        if (stream) {
          window.apiService.get(`/api/groups/${window.currentActiveGroup._id}/messages`)
            .then((res) => {
              if (res.success) {
                stream.innerHTML = '';
                res.messages.forEach((m) => {
                  const b = document.createElement('div');
                  b.className = `message-bubble-row ${(m.sender?._id || m.sender) === window.apiService.getCurrentUser()?._id ? 'sent' : 'received'}`;
                  const isSent = (m.sender?._id || m.sender) === window.apiService.getCurrentUser()?._id;
                  b.innerHTML = `
                    <div class="chat-bubble ${isSent ? 'sent' : 'received'}">
                      ${!isSent ? `<div style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.2rem;">@${m.sender?.username || 'user'}</div>` : ''}
                      ${window.renderAttachmentHTML ? window.renderAttachmentHTML(m) : ''}
                      ${m.text && m.text !== m.fileName ? `<div class="chat-bubble-text">${escapeHtml(m.text)}</div>` : ''}
                      <div class="chat-bubble-footer">
                        <span>${window.DateFormatter.formatTime(m.createdAt)}</span>
                        ${isSent ? `<span class="status-tick sent">✓</span>` : ''}
                      </div>
                    </div>
                  `;
                  stream.appendChild(b);
                });
                stream.scrollTop = stream.scrollHeight;
              }
            }).catch(() => {});
        }
      }
    } else {
      // Direct chat: Trigger openConversation with current contact
      const activeContactItem = document.querySelector('#chat-contacts-scroll .contact-card-item.active');
      if (activeContactItem) {
        activeContactItem.click();
      }
    }
  };

  const executeInChatSearch = async (page = 1) => {
    inChatPage = page;
    const q = inChatSearchInput.value.trim();
    const date = inChatSearchDate.value;

    const stream = document.getElementById('chat-messages-stream');
    if (!stream) return;

    // Determine current conversation
    let convParam = '';
    if (window.activeChatMode === 'group' && window.currentActiveGroup) {
      convParam = `groupId=${encodeURIComponent(window.currentActiveGroup._id)}&conversationType=group`;
    } else {
      const activeContactItem = document.querySelector('#chat-contacts-scroll .contact-card-item.active');
      const userId = activeContactItem?.getAttribute('data-user-id');
      if (!userId) {
        inChatSearchCount.textContent = 'No chat open';
        return;
      }
      convParam = `userId=${encodeURIComponent(userId)}&conversationType=direct`;
    }

    let url = `/api/messages/search?${convParam}&page=${inChatPage}&limit=20`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (date) url += `&date=${encodeURIComponent(date)}`;

    try {
      inChatSearchCount.textContent = 'Searching...';
      const data = await window.apiService.get(url);

      if (data.success) {
        inChatTotalPages = data.totalPages || 1;
        inChatSearchCount.textContent = `${data.total} result${data.total === 1 ? '' : 's'} (${data.page}/${inChatTotalPages})`;
        inChatSearchPrevBtn.disabled = inChatPage <= 1;
        inChatSearchNextBtn.disabled = inChatPage >= inChatTotalPages;

        stream.innerHTML = '';

        if (data.messages.length === 0) {
          stream.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-dim); font-size: 0.9rem;">
              No messages found matching your search.
            </div>
          `;
          return;
        }

        const currentUser = window.apiService.getCurrentUser();
        data.messages.forEach((msg) => {
          const isSent = (msg.sender?._id || msg.sender) === currentUser?._id;
          const senderName = msg.sender?.username ? `@${msg.sender.username}` : '';
          const hasAttachment = Boolean(msg.fileUrl || msg.fileName);
          const showText = msg.text && msg.text !== msg.fileName;
          const highlightedText = highlightMatch(msg.text, q);

          const bubbleRow = document.createElement('div');
          bubbleRow.className = `message-bubble-row ${isSent ? 'sent' : 'received'}`;
          bubbleRow.innerHTML = `
            <div class="chat-bubble ${isSent ? 'sent' : 'received'}">
              ${!isSent && window.activeChatMode === 'group' ? `<div style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.2rem;">${senderName}</div>` : ''}
              ${hasAttachment && window.renderAttachmentHTML ? window.renderAttachmentHTML(msg) : ''}
              ${showText ? `<div class="chat-bubble-text">${highlightedText}</div>` : ''}
              <div class="chat-bubble-footer">
                <span>${window.DateFormatter.formatDate(msg.createdAt)} ${window.DateFormatter.formatTime(msg.createdAt)}</span>
              </div>
            </div>
          `;
          stream.appendChild(bubbleRow);
        });

        stream.scrollTop = stream.scrollHeight;
      }
    } catch (err) {
      inChatSearchCount.textContent = 'Error';
      console.error('In-chat search error:', err);
    }
  };

  if (inChatSearchBtn) {
    inChatSearchBtn.addEventListener('click', toggleInChatSearchBar);
  }

  if (inChatSearchCloseBtn) {
    inChatSearchCloseBtn.addEventListener('click', closeInChatSearch);
  }

  if (inChatSearchInput) {
    inChatSearchInput.addEventListener('input', () => {
      clearTimeout(inChatTimeout);
      inChatTimeout = setTimeout(() => executeInChatSearch(1), 300);
    });
  }

  if (inChatSearchDate) {
    inChatSearchDate.addEventListener('change', () => executeInChatSearch(1));
  }

  if (inChatSearchPrevBtn) {
    inChatSearchPrevBtn.addEventListener('click', () => {
      if (inChatPage > 1) executeInChatSearch(inChatPage - 1);
    });
  }

  if (inChatSearchNextBtn) {
    inChatSearchNextBtn.addEventListener('click', () => {
      if (inChatPage < inChatTotalPages) executeInChatSearch(inChatPage + 1);
    });
  }

  /* ==========================================================================
     Global Search Hub Modal
     ========================================================================== */

  const openGlobalSearchModal = async () => {
    if (!searchModal) return;
    searchModal.style.display = 'flex';
    searchModal.classList.add('open');
    searchMainInput.focus();

    // Populate conversation filter options
    populateConversationFilterOptions();
  };

  const closeGlobalSearchModal = () => {
    if (!searchModal) return;
    searchModal.style.display = 'none';
    searchModal.classList.remove('open');
  };

  const populateConversationFilterOptions = async () => {
    if (!searchConvFilter) return;

    try {
      const [usersRes, groupsRes] = await Promise.all([
        window.apiService.get('/api/users').catch(() => ({ success: false })),
        window.apiService.get('/api/groups').catch(() => ({ success: false }))
      ]);

      let html = '<option value="">All Conversations</option>';

      if (groupsRes.success && groupsRes.groups?.length > 0) {
        html += '<optgroup label="Groups">';
        groupsRes.groups.forEach((g) => {
          html += `<option value="group:${g._id}">👥 ${escapeHtml(g.name)}</option>`;
        });
        html += '</optgroup>';
      }

      if (usersRes.success && usersRes.users?.length > 0) {
        html += '<optgroup label="Direct Chats">';
        usersRes.users.forEach((u) => {
          html += `<option value="direct:${u._id}">👤 @${escapeHtml(u.username)}</option>`;
        });
        html += '</optgroup>';
      }

      searchConvFilter.innerHTML = html;
    } catch (err) {
      console.error('Failed to populate conversation filter:', err);
    }
  };

  // Switch Global Search Tabs
  const setGlobalSearchTab = (tab) => {
    currentSearchTab = tab;
    globalSearchPage = 1;

    [searchTabMessages, searchTabUsers, searchTabGroups].forEach((b) => b?.classList.remove('active'));

    if (tab === 'messages') {
      searchTabMessages?.classList.add('active');
      searchMainInput.placeholder = 'Search messages by text...';
      if (searchMsgFilters) searchMsgFilters.style.display = 'flex';
    } else if (tab === 'users') {
      searchTabUsers?.classList.add('active');
      searchMainInput.placeholder = 'Search users by username or email...';
      if (searchMsgFilters) searchMsgFilters.style.display = 'none';
    } else if (tab === 'groups') {
      searchTabGroups?.classList.add('active');
      searchMainInput.placeholder = 'Search groups by name or description...';
      if (searchMsgFilters) searchMsgFilters.style.display = 'none';
    }

    if (searchMainInput.value.trim()) {
      executeGlobalSearch(1);
    } else {
      renderSearchPlaceholder();
    }
  };

  const renderSearchPlaceholder = () => {
    if (!searchResultsList) return;
    if (searchPaginationBar) searchPaginationBar.style.display = 'none';

    let msg = 'Type a query above and hit Search.';
    if (currentSearchTab === 'messages') msg = 'Search message text across direct and group conversations.';
    if (currentSearchTab === 'users') msg = 'Search community users by username or email.';
    if (currentSearchTab === 'groups') msg = 'Search groups by name or description.';

    searchResultsList.innerHTML = `<div class="search-results-empty">${msg}</div>`;
  };

  // Execute Global Search
  const executeGlobalSearch = async (page = 1) => {
    globalSearchPage = page;
    const q = searchMainInput.value.trim();

    if (!searchResultsList) return;

    searchResultsList.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-dim); font-size: 0.9rem;">
        Searching...
      </div>
    `;

    try {
      if (currentSearchTab === 'messages') {
        await executeMessageSearch(q, page);
      } else if (currentSearchTab === 'users') {
        await executeUserSearch(q, page);
      } else if (currentSearchTab === 'groups') {
        await executeGroupSearch(q, page);
      }
    } catch (err) {
      searchResultsList.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: #f87171; font-size: 0.85rem;">
          Search failed: ${err.message}
        </div>
      `;
    }
  };

  // 1. Message Search Handler
  const executeMessageSearch = async (q, page) => {
    let url = `/api/messages/search?page=${page}&limit=15`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    // Conversation filter
    const convVal = searchConvFilter?.value;
    if (convVal) {
      const [type, id] = convVal.split(':');
      if (type === 'group') {
        url += `&groupId=${encodeURIComponent(id)}`;
      } else if (type === 'direct') {
        url += `&userId=${encodeURIComponent(id)}`;
      }
    }

    // Date filters
    const sDate = searchStartDate?.value;
    const eDate = searchEndDate?.value;
    if (sDate) url += `&startDate=${encodeURIComponent(sDate)}`;
    if (eDate) url += `&endDate=${encodeURIComponent(eDate)}`;

    const data = await window.apiService.get(url);
    if (!data.success) throw new Error(data.message);

    globalTotalPages = data.totalPages || 1;
    globalTotalCount = data.total || 0;
    updatePaginationUI();

    if (data.messages.length === 0) {
      searchResultsList.innerHTML = `
        <div class="search-results-empty">
          No messages found matching your criteria.
        </div>
      `;
      return;
    }

    const currentUser = window.apiService.getCurrentUser();
    searchResultsList.innerHTML = data.messages
      .map((msg) => {
        const isSent = (msg.sender?._id || msg.sender) === currentUser?._id;
        const sender = msg.sender || {};
        const receiver = msg.receiver || {};
        const group = msg.groupId || null;
        const timeStr = `${window.DateFormatter.formatDate(msg.createdAt)} • ${window.DateFormatter.formatTime(msg.createdAt)}`;
        const snippet = highlightMatch(msg.text || (msg.fileName ? `[Attachment: ${msg.fileName}]` : ''), q);

        let contextBadge = '';
        if (group) {
          contextBadge = `<span class="search-result-badge">👥 ${escapeHtml(group.name || 'Group')}</span>`;
        } else if (isSent) {
          contextBadge = `<span class="search-result-badge">to @${escapeHtml(receiver.username || 'user')}</span>`;
        } else {
          contextBadge = `<span class="search-result-badge">from @${escapeHtml(sender.username || 'user')}</span>`;
        }

        return `
          <div class="search-result-card" data-msg-id="${msg._id}">
            <div class="search-result-avatar">
              ${sender.profileImage || '👤'}
            </div>
            <div class="search-result-content">
              <div class="search-result-top">
                <div class="search-result-title">
                  <span>@${escapeHtml(sender.username || 'User')}</span>
                  ${contextBadge}
                </div>
                <span class="search-result-date">${timeStr}</span>
              </div>
              <div class="search-result-snippet">${snippet}</div>
            </div>
            <button
              class="btn btn-primary search-result-action-btn search-open-chat-btn"
              type="button"
              data-type="${group ? 'group' : 'direct'}"
              data-target-id="${group ? group._id : (isSent ? receiver._id : sender._id)}"
              data-target-name="${group ? group.name : (isSent ? receiver.username : sender.username)}"
              data-target-img="${group ? (group.image || '👥') : (isSent ? receiver.profileImage : sender.profileImage)}"
            >
              Open
            </button>
          </div>
        `;
      })
      .join('');

    // Attach Open Chat handlers
    searchResultsList.querySelectorAll('.search-open-chat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        const targetId = btn.getAttribute('data-target-id');
        const targetName = btn.getAttribute('data-target-name');
        const targetImg = btn.getAttribute('data-target-img');

        closeGlobalSearchModal();

        if (type === 'group') {
          // Switch to groups tab
          document.getElementById('tab-chats-groups')?.click();
          if (typeof window.openGroupConversation === 'function') {
            window.openGroupConversation({ _id: targetId, name: targetName, image: targetImg });
          } else {
            // Find in sidebar
            const groupItem = document.querySelector(`#chat-groups-scroll .contact-card-item[data-group-id="${targetId}"]`);
            if (groupItem) groupItem.click();
          }
        } else {
          // Direct chat
          document.getElementById('tab-chats-direct')?.click();
          if (typeof window.openConversationWithUser === 'function') {
            window.openConversationWithUser({ _id: targetId, username: targetName, profileImage: targetImg });
          } else {
            const contactItem = document.querySelector(`#chat-contacts-scroll .contact-card-item[data-user-id="${targetId}"]`);
            if (contactItem) contactItem.click();
          }
        }
      });
    });
  };

  // 2. User Search Handler
  const executeUserSearch = async (q, page) => {
    const url = `/api/users/search?q=${encodeURIComponent(q)}&page=${page}&limit=15`;
    const data = await window.apiService.get(url);
    if (!data.success) throw new Error(data.message);

    globalTotalPages = data.totalPages || 1;
    globalTotalCount = data.total || 0;
    updatePaginationUI();

    if (data.users.length === 0) {
      searchResultsList.innerHTML = `
        <div class="search-results-empty">
          No users found matching "${escapeHtml(q)}".
        </div>
      `;
      return;
    }

    searchResultsList.innerHTML = data.users
      .map((u) => {
        const isOnline = u.online === true;
        const highlightedName = highlightMatch(u.username, q);
        const highlightedEmail = highlightMatch(u.email, q);

        return `
          <div class="search-result-card">
            <div class="search-result-avatar" style="position: relative;">
              ${u.profileImage || '👤'}
            </div>
            <div class="search-result-content">
              <div class="search-result-top">
                <div class="search-result-title">
                  <span>@${highlightedName}</span>
                  <span class="status-pill ${isOnline ? 'success' : 'warning'}" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">
                    ${isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
                <span class="search-result-date">${highlightedEmail}</span>
              </div>
              <div class="search-result-snippet">${escapeHtml(u.bio || 'Available to chat')}</div>
            </div>
            <button
              class="btn btn-primary search-result-action-btn search-user-chat-btn"
              type="button"
              data-user-id="${u._id}"
              data-username="${escapeHtml(u.username)}"
              data-image="${escapeHtml(u.profileImage || '👤')}"
            >
              💬 Chat
            </button>
          </div>
        `;
      })
      .join('');

    searchResultsList.querySelectorAll('.search-user-chat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uId = btn.getAttribute('data-user-id');
        const uName = btn.getAttribute('data-username');
        const uImg = btn.getAttribute('data-image');

        closeGlobalSearchModal();
        document.getElementById('tab-chats-direct')?.click();
        if (typeof window.openConversationWithUser === 'function') {
          window.openConversationWithUser({ _id: uId, username: uName, profileImage: uImg });
        }
      });
    });
  };

  // 3. Group Search Handler
  const executeGroupSearch = async (q, page) => {
    const url = `/api/groups/search?q=${encodeURIComponent(q)}&page=${page}&limit=15`;
    const data = await window.apiService.get(url);
    if (!data.success) throw new Error(data.message);

    globalTotalPages = data.totalPages || 1;
    globalTotalCount = data.total || 0;
    updatePaginationUI();

    if (data.groups.length === 0) {
      searchResultsList.innerHTML = `
        <div class="search-results-empty">
          No groups found matching "${escapeHtml(q)}".
        </div>
      `;
      return;
    }

    searchResultsList.innerHTML = data.groups
      .map((g) => {
        const highlightedName = highlightMatch(g.name, q);
        const highlightedDesc = highlightMatch(g.description || 'No description', q);

        return `
          <div class="search-result-card">
            <div class="search-result-avatar">
              ${g.image || '👥'}
            </div>
            <div class="search-result-content">
              <div class="search-result-top">
                <div class="search-result-title">
                  <span>${highlightedName}</span>
                  <span class="search-result-badge">${g.members?.length || 0} members</span>
                </div>
              </div>
              <div class="search-result-snippet">${highlightedDesc}</div>
            </div>
            <button
              class="btn btn-primary search-result-action-btn search-open-group-btn"
              type="button"
              data-group-id="${g._id}"
              data-group-name="${escapeHtml(g.name)}"
              data-group-image="${escapeHtml(g.image || '👥')}"
            >
              Open
            </button>
          </div>
        `;
      })
      .join('');

    searchResultsList.querySelectorAll('.search-open-group-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gId = btn.getAttribute('data-group-id');
        const gName = btn.getAttribute('data-group-name');
        const gImg = btn.getAttribute('data-group-image');

        closeGlobalSearchModal();
        document.getElementById('tab-chats-groups')?.click();
        const grpItem = document.querySelector(`#chat-groups-scroll .contact-card-item[data-group-id="${gId}"]`);
        if (grpItem) {
          grpItem.click();
        } else if (typeof window.openGroupConversation === 'function') {
          window.openGroupConversation({ _id: gId, name: gName, image: gImg });
        }
      });
    });
  };

  // Update Pagination UI
  const updatePaginationUI = () => {
    if (!searchPaginationBar) return;
    if (globalTotalCount > 0) {
      searchPaginationBar.style.display = 'flex';
      searchPageIndicator.textContent = `Page ${globalSearchPage} of ${globalTotalPages} (${globalTotalCount} total)`;
      searchPrevBtn.disabled = globalSearchPage <= 1;
      searchNextBtn.disabled = globalSearchPage >= globalTotalPages;
    } else {
      searchPaginationBar.style.display = 'none';
    }
  };

  // Event Listeners - Global Search
  if (globalSearchBtn) {
    globalSearchBtn.addEventListener('click', openGlobalSearchModal);
  }

  if (searchModalCloseBtn) {
    searchModalCloseBtn.addEventListener('click', closeGlobalSearchModal);
  }

  if (searchModal) {
    searchModal.addEventListener('click', (e) => {
      if (e.target === searchModal) closeGlobalSearchModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchModal && searchModal.style.display === 'flex') {
      closeGlobalSearchModal();
    }
  });

  if (searchTabMessages) searchTabMessages.addEventListener('click', () => setGlobalSearchTab('messages'));
  if (searchTabUsers) searchTabUsers.addEventListener('click', () => setGlobalSearchTab('users'));
  if (searchTabGroups) searchTabGroups.addEventListener('click', () => setGlobalSearchTab('groups'));

  if (searchExecuteBtn) {
    searchExecuteBtn.addEventListener('click', () => executeGlobalSearch(1));
  }

  if (searchMainInput) {
    searchMainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeGlobalSearch(1);
      }
    });
  }

  if (searchResetFiltersBtn) {
    searchResetFiltersBtn.addEventListener('click', () => {
      if (searchConvFilter) searchConvFilter.value = '';
      if (searchStartDate) searchStartDate.value = '';
      if (searchEndDate) searchEndDate.value = '';
      executeGlobalSearch(1);
    });
  }

  if (searchPrevBtn) {
    searchPrevBtn.addEventListener('click', () => {
      if (globalSearchPage > 1) executeGlobalSearch(globalSearchPage - 1);
    });
  }

  if (searchNextBtn) {
    searchNextBtn.addEventListener('click', () => {
      if (globalSearchPage < globalTotalPages) executeGlobalSearch(globalSearchPage + 1);
    });
  }
});
