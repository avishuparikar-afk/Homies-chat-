document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const chatLayout = document.getElementById('chat-layout-container');
  const contactsScroll = document.getElementById('chat-contacts-scroll');
  const chatEmptyView = document.getElementById('chat-empty-view');
  const chatActiveView = document.getElementById('chat-active-view');
  const chatBackBtn = document.getElementById('chat-back-btn');

  // Active Chat Header Elements
  const headerAvatar = document.getElementById('chat-header-avatar');
  const headerUsername = document.getElementById('chat-header-username');
  const headerStatusDot = document.getElementById('chat-header-status-dot');
  const headerStatusSub = document.getElementById('chat-header-status-sub');

  // Stream & Input Elements
  const messagesStream = document.getElementById('chat-messages-stream');
  const typingIndicator = document.getElementById('chat-typing-indicator');
  const chatForm = document.getElementById('chat-input-form');
  const messageInput = document.getElementById('chat-message-input');

  let activeContact = null;
  let typingTimeout = null;
  let isCurrentlyTyping = false;

  // Auto-scroll to bottom of messages stream
  const scrollToBottom = () => {
    if (messagesStream) {
      messagesStream.scrollTop = messagesStream.scrollHeight;
    }
  };

  // Format delivery state tick HTML
  const getStatusTickHTML = (status) => {
    const s = (status || 'sent').toLowerCase();
    if (s === 'read') {
      return `<span class="status-tick read" title="Read">✓✓</span>`;
    }
    if (s === 'delivered') {
      return `<span class="status-tick delivered" title="Delivered">✓✓</span>`;
    }
    return `<span class="status-tick sent" title="Sent">✓</span>`;
  };

  // Format byte sizes into readable string
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };
  window.formatBytes = formatBytes;

  // File icon by extension
  const getFileIcon = (fileName = '', mime = '') => {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (ext === 'pdf' || mime === 'application/pdf') return '📕';
    if (['doc', 'docx'].includes(ext) || mime.includes('word')) return '📘';
    if (ext === 'txt' || mime.includes('text')) return '📄';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return '🖼️';
    return '📎';
  };
  window.getFileIcon = getFileIcon;

  // Render attachment HTML (Images / Documents)
  const renderAttachmentHTML = (msg) => {
    if (!msg.fileUrl && !msg.fileName) return '';
    const token = window.apiService?.getToken() || '';
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    const downloadUrl = (msg.fileUrl || `/api/files/download/${msg.fileName}`) + tokenParam;
    const viewUrl = `/api/files/view/${msg.fileName}` + tokenParam;
    const isImage =
      msg.messageType === 'image' ||
      (msg.fileMimeType && msg.fileMimeType.toLowerCase().startsWith('image/'));
    const sizeText = formatBytes(msg.fileSize);
    const safeName = escapeHtml(msg.fileName || 'Attachment');

    if (isImage) {
      return `
        <div class="chat-media-card image-card">
          <div class="chat-media-preview-wrap" data-view-url="${viewUrl}" data-safe-name="${safeName}" data-size="${sizeText}">
            <img src="${viewUrl}" alt="${safeName}" class="chat-media-image" loading="lazy" />
          </div>
          <div class="chat-media-info">
            <span class="chat-media-name" title="${safeName}">${safeName}</span>
            <span class="chat-media-size">${sizeText}</span>
            <a href="${downloadUrl}" download="${safeName}" class="chat-media-action-btn" target="_blank" title="Download Image">⬇️</a>
          </div>
        </div>
      `;
    } else {
      const icon = getFileIcon(msg.fileName, msg.fileMimeType);
      return `
        <div class="chat-media-card file-card">
          <div class="file-card-icon">${icon}</div>
          <div class="chat-media-info" style="flex: 1; min-width: 0;">
            <span class="chat-media-name" title="${safeName}">${safeName}</span>
            <span class="chat-media-size">${sizeText}</span>
          </div>
          <a href="${downloadUrl}" download="${safeName}" class="chat-media-action-btn" target="_blank" title="Download Document">⬇️</a>
        </div>
      `;
    }
  };
  window.renderAttachmentHTML = renderAttachmentHTML;

  // Render Single Message Bubble
  const createMessageBubble = (msg) => {
    const currentUser = window.apiService.getCurrentUser();
    const isSent = (msg.sender?._id || msg.sender) === currentUser?._id;
    const timeFormatted = window.DateFormatter.formatTime(msg.createdAt || new Date());
    const hasAttachment = Boolean(msg.fileUrl || msg.fileName);
    const showText = msg.text && msg.text !== msg.fileName;

    const bubbleRow = document.createElement('div');
    bubbleRow.className = `message-bubble-row ${isSent ? 'sent' : 'received'}`;
    bubbleRow.id = `msg-${msg._id}`;
    bubbleRow.setAttribute('data-msg-id', msg._id);

    if (msg.isDeletedForEveryone) {
      bubbleRow.innerHTML = `
        <div class="chat-bubble ${isSent ? 'sent' : 'received'} deleted">
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
        ${hasAttachment ? renderAttachmentHTML(msg) : ''}
        ${showText ? `<div class="chat-bubble-text">${escapeHtml(msg.text)}</div>` : ''}
        <div class="chat-bubble-footer">
          <span>${timeFormatted}</span>
          ${isSent ? `<span class="msg-status-tick-container" id="tick-${msg._id}">${getStatusTickHTML(msg.status)}</span>` : ''}
        </div>
      </div>
      <button class="msg-delete-btn" type="button" title="Delete message">🗑️</button>
    `;

    const delBtn = bubbleRow.querySelector('.msg-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.openDeleteModal === 'function') {
          window.openDeleteModal(msg._id, isSent, false);
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

  // Update ticks for a message or conversation
  const updateMessageTick = (messageId, status) => {
    const tickEl = document.getElementById(`tick-${messageId}`);
    if (tickEl) {
      tickEl.innerHTML = getStatusTickHTML(status);
    }
  };

  const updateAllSentMessagesTick = (status) => {
    document.querySelectorAll('.msg-status-tick-container').forEach((el) => {
      el.innerHTML = getStatusTickHTML(status);
    });
  };

  // Select Contact & Open Conversation
  const openConversation = async (contact) => {
    activeContact = contact;
    window.activeChatMode = 'direct';
    window.currentActiveGroup = null;

    const groupInfoToggleBtn = document.getElementById('chat-group-info-btn');
    if (groupInfoToggleBtn) groupInfoToggleBtn.style.display = 'none';

    // Highlight active contact item
    document.querySelectorAll('.contact-card-item').forEach((item) => {
      if (item.getAttribute('data-user-id') === contact._id) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update Header
    headerAvatar.textContent = contact.profileImage || '👤';
    headerUsername.textContent = `@${contact.username}`;
    const isOnline = contact.online === true;
    if (headerStatusDot) {
      headerStatusDot.style.display = 'block';
      headerStatusDot.className = `online-badge-dot ${isOnline ? 'online' : ''}`;
    }
    headerStatusSub.textContent = window.DateFormatter.formatLastSeen(contact.lastSeen, isOnline);
    headerStatusSub.className = 'chat-header-status-sub';

    // Show Chat View, hide Empty State
    chatEmptyView.style.display = 'none';
    chatActiveView.style.display = 'flex';
    if (chatLayout) chatLayout.classList.add('mobile-chat-open');
    const appShell = document.getElementById('app-shell');
    if (appShell) appShell.classList.add('mobile-chat-open');

    // Notify server that conversation has been opened and messages are READ
    if (window.chatSocket && window.chatSocket.connected) {
      window.chatSocket.emit('message-read', { senderId: contact._id });
    }
    window.apiService.put(`/api/messages/read/${contact._id}`, {}).catch(() => {});

    // Fetch Message History
    try {
      if (typeof window.showMessagesSkeleton === 'function') {
        window.showMessagesSkeleton(messagesStream, 5);
      } else {
        messagesStream.innerHTML = `
          <div style="text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.85rem;">
            Loading conversation history...
          </div>
        `;
      }

      const data = await window.apiService.get(`/api/messages/${contact._id}`);

      messagesStream.innerHTML = '';

      if (data.success && data.messages.length > 0) {
        data.messages.forEach((msg) => {
          messagesStream.appendChild(createMessageBubble(msg));
        });
      } else {
        messagesStream.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-dim); font-size: 0.9rem;">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">👋</div>
            <div style="font-weight: 600; color: var(--text-main); margin-bottom: 0.25rem;">No messages yet</div>
            <div>Say hello to @${contact.username} to start chatting!</div>
          </div>
        `;
      }

      scrollToBottom();
      messageInput.focus();
    } catch (err) {
      messagesStream.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--status-danger); font-size: 0.85rem;">
          Failed to load messages: ${err.message}
        </div>
      `;
    }
  };

  // Back button on mobile
  if (chatBackBtn) {
    chatBackBtn.addEventListener('click', () => {
      if (chatLayout) chatLayout.classList.remove('mobile-chat-open');
      const appShell = document.getElementById('app-shell');
      if (appShell) appShell.classList.remove('mobile-chat-open');
    });
  }

  // Image Lightbox Viewer
  const lightboxModal = document.getElementById('image-lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxFilename = document.getElementById('lightbox-filename');
  const lightboxSize = document.getElementById('lightbox-meta-size');
  const lightboxDownload = document.getElementById('lightbox-download-link');
  const lightboxCloseBtn = document.getElementById('lightbox-close-btn');

  window.openImageLightbox = (url, name, size) => {
    if (!lightboxModal) return;
    if (lightboxImg) lightboxImg.src = url;
    if (lightboxFilename) lightboxFilename.textContent = name || 'Image Preview';
    if (lightboxSize) lightboxSize.textContent = size || '';
    if (lightboxDownload) {
      lightboxDownload.href = url.replace('/api/files/view/', '/api/files/download/');
      lightboxDownload.setAttribute('download', name || 'image');
    }
    lightboxModal.style.display = 'flex';
  };

  const closeLightbox = () => {
    if (lightboxModal) lightboxModal.style.display = 'none';
    if (lightboxImg) lightboxImg.src = '';
  };

  if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
  if (lightboxModal) {
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) closeLightbox();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxModal && lightboxModal.style.display === 'flex') {
      closeLightbox();
    }
  });

  // Attachment Handling Elements
  const attachBtn = document.getElementById('chat-attach-btn');
  const fileInput = document.getElementById('chat-file-input');
  const attachmentTray = document.getElementById('chat-attachment-tray');
  const previewMedia = document.getElementById('attachment-preview-media');
  const previewFileName = document.getElementById('attachment-file-name');
  const previewFileSize = document.getElementById('attachment-file-size');
  const previewProgressWrap = document.getElementById('attachment-progress-wrapper');
  const previewProgressFill = document.getElementById('attachment-progress-fill');
  const previewProgressText = document.getElementById('attachment-progress-text');
  const removeAttachmentBtn = document.getElementById('attachment-remove-btn');
  const sendBtn = document.getElementById('chat-send-btn');

  let selectedAttachmentFile = null;

  const resetAttachmentTray = () => {
    selectedAttachmentFile = null;
    if (fileInput) fileInput.value = '';
    if (attachmentTray) attachmentTray.style.display = 'none';
    if (previewProgressWrap) previewProgressWrap.style.display = 'none';
    if (previewProgressFill) previewProgressFill.style.width = '0%';
    if (previewProgressText) previewProgressText.textContent = '0%';
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
  };

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;

      const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.txt'];
      const fileExt = '.' + file.name.split('.').pop().toLowerCase();

      if (!allowedExts.includes(fileExt)) {
        alert('Unsupported file type. Please select JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX, or TXT.');
        fileInput.value = '';
        return;
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('File size exceeds the 10MB limit.');
        fileInput.value = '';
        return;
      }

      selectedAttachmentFile = file;

      if (previewFileName) previewFileName.textContent = file.name;
      if (previewFileSize) previewFileSize.textContent = formatBytes(file.size);

      // Render thumbnail or document icon
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (previewMedia) {
            previewMedia.innerHTML = `<img src="${e.target.result}" class="attachment-preview-thumb" alt="Preview">`;
          }
        };
        reader.readAsDataURL(file);
      } else {
        if (previewMedia) {
          previewMedia.innerHTML = getFileIcon(file.name, file.type);
        }
      }

      if (attachmentTray) attachmentTray.style.display = 'block';
      if (previewProgressWrap) previewProgressWrap.style.display = 'none';
      messageInput.focus();
    });
  }

  if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener('click', resetAttachmentTray);
  }

  // Handle Send Message (Direct and Group, with File / Attachment support)
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = messageInput.value.trim();

      // Ensure there is either text or an attachment
      if (!text && !selectedAttachmentFile) return;

      const isGroup = window.activeChatMode === 'group' && window.currentActiveGroup;
      const isDirect = !isGroup && activeContact;
      if (!isGroup && !isDirect) return;

      let uploadedFileData = null;

      // Handle file upload with progress tracking if an attachment is selected
      if (selectedAttachmentFile) {
        try {
          if (sendBtn) sendBtn.disabled = true;
          if (attachBtn) attachBtn.disabled = true;
          if (previewProgressWrap) previewProgressWrap.style.display = 'flex';

          const formData = new FormData();
          formData.append('file', selectedAttachmentFile);
          if (isGroup) {
            formData.append('conversationType', 'group');
            formData.append('groupId', window.currentActiveGroup._id);
          } else {
            formData.append('conversationType', 'direct');
            formData.append('recipientId', activeContact._id);
          }

          const uploadRes = await window.apiService.upload(
            '/api/files/upload',
            formData,
            (pct) => {
              if (previewProgressFill) previewProgressFill.style.width = `${pct}%`;
              if (previewProgressText) previewProgressText.textContent = `${pct}%`;
            }
          );

          if (uploadRes.success && uploadRes.file) {
            uploadedFileData = uploadRes.file;
          } else {
            throw new Error(uploadRes.message || 'File upload failed');
          }
        } catch (uploadErr) {
          alert(`Attachment upload failed: ${uploadErr.message}`);
          if (sendBtn) sendBtn.disabled = false;
          if (attachBtn) attachBtn.disabled = false;
          return;
        }
      }

      if (isGroup) {
        // Group Mode
        if (isCurrentlyTyping && window.chatSocket) {
          window.chatSocket.emit('group-stop-typing', { groupId: window.currentActiveGroup._id });
          isCurrentlyTyping = false;
          clearTimeout(typingTimeout);
        }

        if (window.chatSocket && window.chatSocket.connected) {
          const payload = {
            groupId: window.currentActiveGroup._id,
            text
          };

          if (uploadedFileData) {
            payload.messageType = uploadedFileData.fileType;
            payload.fileUrl = uploadedFileData.fileUrl;
            payload.fileName = uploadedFileData.originalName;
            payload.fileSize = uploadedFileData.size;
            payload.fileMimeType = uploadedFileData.mimeType;
          }

          window.chatSocket.emit('group-message', payload);
          messageInput.value = '';
          resetAttachmentTray();
          messageInput.focus();
        }
      } else if (isDirect) {
        // Direct One-to-One Mode
        if (isCurrentlyTyping && window.chatSocket) {
          window.chatSocket.emit('stop-typing', { receiver: activeContact._id });
          isCurrentlyTyping = false;
          clearTimeout(typingTimeout);
        }

        if (window.chatSocket && window.chatSocket.connected) {
          const payload = {
            receiver: activeContact._id,
            text
          };

          if (uploadedFileData) {
            payload.messageType = uploadedFileData.fileType;
            payload.fileUrl = uploadedFileData.fileUrl;
            payload.fileName = uploadedFileData.originalName;
            payload.fileSize = uploadedFileData.size;
            payload.fileMimeType = uploadedFileData.mimeType;
          }

          window.chatSocket.emit('send-message', payload);
          messageInput.value = '';
          resetAttachmentTray();
          messageInput.focus();
        }
      }
    });
  }

  // Handle Typing Input Events (Direct and Group)
  if (messageInput) {
    messageInput.addEventListener('input', () => {
      if (!window.chatSocket) return;

      if (window.activeChatMode === 'group' && window.currentActiveGroup) {
        if (!isCurrentlyTyping) {
          isCurrentlyTyping = true;
          window.chatSocket.emit('group-typing', { groupId: window.currentActiveGroup._id });
        }

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          isCurrentlyTyping = false;
          if (window.chatSocket) {
            window.chatSocket.emit('group-stop-typing', { groupId: window.currentActiveGroup._id });
          }
        }, 1500);
      } else if (activeContact) {
        if (!isCurrentlyTyping) {
          isCurrentlyTyping = true;
          window.chatSocket.emit('typing', { receiver: activeContact._id });
        }

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          isCurrentlyTyping = false;
          if (window.chatSocket) {
            window.chatSocket.emit('stop-typing', { receiver: activeContact._id });
          }
        }, 1500);
      }
    });
  }

  // Socket.IO Real-time listeners setup
  const setupSocketListeners = () => {
    if (!window.chatSocket) {
      setTimeout(setupSocketListeners, 300);
      return;
    }

    const socket = window.chatSocket;

    // Event: receive-message
    socket.off('receive-message').on('receive-message', (msg) => {
      const currentUser = window.apiService.getCurrentUser();
      if (!currentUser) return;

      const senderId = msg.sender?._id || msg.sender;
      const receiverId = msg.receiver?._id || msg.receiver;

      // If message is for currently open conversation
      if (
        activeContact &&
        (senderId === activeContact._id || (senderId === currentUser._id && receiverId === activeContact._id))
      ) {
        const emptyMsg = messagesStream.querySelector('div[style*="text-align: center"]');
        if (emptyMsg) emptyMsg.remove();

        if (typingIndicator) typingIndicator.style.display = 'none';

        const bubble = createMessageBubble(msg);
        messagesStream.appendChild(bubble);
        scrollToBottom();

        // If received from active contact, acknowledge delivery and read immediately
        if (senderId === activeContact._id) {
          socket.emit('message-delivered', { messageId: msg._id, senderId });
          socket.emit('message-read', { messageId: msg._id, senderId });
        }
      } else if (receiverId === currentUser._id) {
        // Message received for inactive conversation: acknowledge delivery
        socket.emit('message-delivered', { messageId: msg._id, senderId });
      }
    });

    // Event: message-sent (Single grey tick ✓)
    socket.off('message-sent').on('message-sent', (data) => {
      if (data.messageId) {
        updateMessageTick(data.messageId, 'sent');
      }
    });

    // Event: message-delivered (Double grey tick ✓✓)
    socket.off('message-delivered').on('message-delivered', (data) => {
      if (data.messageId) {
        updateMessageTick(data.messageId, 'delivered');
      } else if (activeContact && data.receiverId === activeContact._id) {
        updateAllSentMessagesTick('delivered');
      }
    });

    // Event: message-read (Double blue tick ✓✓ highlighted)
    socket.off('message-read').on('message-read', (data) => {
      if (data.messageId) {
        updateMessageTick(data.messageId, 'read');
      } else if (activeContact && data.readerId === activeContact._id) {
        updateAllSentMessagesTick('read');
      }
    });

    // Event: message-status-updated (Universal handler)
    socket.off('message-status-updated').on('message-status-updated', (data) => {
      const status = data.status || 'sent';
      if (data.messageId) {
        updateMessageTick(data.messageId, status);
      } else if (activeContact && (data.receiverId === activeContact._id || data.readerId === activeContact._id)) {
        updateAllSentMessagesTick(status);
      }
    });

    // Event: typing
    socket.off('typing').on('typing', (data) => {
      if (activeContact && data.sender === activeContact._id) {
        headerStatusSub.textContent = 'typing...';
        headerStatusSub.classList.add('typing-active');
        if (typingIndicator) {
          typingIndicator.style.display = 'inline-flex';
          scrollToBottom();
        }
      }
    });

    // Event: stop-typing
    socket.off('stop-typing').on('stop-typing', (data) => {
      if (activeContact && data.sender === activeContact._id) {
        headerStatusSub.className = 'chat-header-status-sub';
        headerStatusSub.textContent = window.DateFormatter.formatLastSeen(
          activeContact.lastSeen,
          activeContact.online
        );
        if (typingIndicator) typingIndicator.style.display = 'none';
      }
    });

    // Event: user-online
    socket.off('user-online').on('user-online', (data) => {
      if (activeContact && activeContact._id === data.userId) {
        activeContact.online = true;
        activeContact.lastSeen = data.lastSeen;
        headerStatusDot.className = 'online-badge-dot online';
        if (!headerStatusSub.classList.contains('typing-active')) {
          headerStatusSub.textContent = 'Online';
        }
      }
    });

    // Event: user-offline
    socket.off('user-offline').on('user-offline', (data) => {
      if (activeContact && activeContact._id === data.userId) {
        activeContact.online = false;
        activeContact.lastSeen = data.lastSeen;
        headerStatusDot.className = 'online-badge-dot';
        if (!headerStatusSub.classList.contains('typing-active')) {
          headerStatusSub.textContent = window.DateFormatter.formatLastSeen(data.lastSeen, false);
        }
      }
    });

    // Event: message-deleted (Phase 10 Synchronized Deletion)
    socket.off('message-deleted').on('message-deleted', (data) => {
      if (data && data.messageId) {
        applyMessageDeletedUI(data.messageId, data.type || 'everyone');
      }
    });
  };

  // Expose openConversation globally
  window.openConversationWithUser = openConversation;

  // Render contacts in chat sidebar
  const renderChatContacts = (users) => {
    if (!contactsScroll) return;

    if (!users || users.length === 0) {
      contactsScroll.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-dim); font-size: 0.85rem;">
          No contacts found.
        </div>
      `;
      return;
    }

    contactsScroll.innerHTML = users
      .map((u) => {
        const isOnline = u.online === true;
        const lastSeenText = window.DateFormatter.formatLastSeen(u.lastSeen, isOnline);
        const isActive = activeContact && activeContact._id === u._id;

        return `
          <div class="contact-card-item ${isActive ? 'active' : ''}" data-user-id="${u._id}">
            <div class="user-avatar-wrapper">
              <div class="user-avatar-img ${isOnline ? 'has-border' : ''}">
                ${u.profileImage || '👤'}
              </div>
              <span class="online-badge-dot ${isOnline ? 'online' : ''}" id="contact-dot-${u._id}"></span>
            </div>
            <div class="user-info-col">
              <div class="user-info-header">
                <span class="user-name">@${u.username}</span>
                <span class="user-last-seen" id="contact-last-seen-${u._id}">${isOnline ? 'Online' : ''}</span>
              </div>
              <div class="user-bio-snippet">${u.bio || 'Available'}</div>
            </div>
          </div>
        `;
      })
      .join('');

    contactsScroll.querySelectorAll('.contact-card-item').forEach((item) => {
      item.addEventListener('click', () => {
        const userId = item.getAttribute('data-user-id');
        const user = users.find((u) => u._id === userId);
        if (user) openConversation(user);
      });
    });
  };

  // Fetch and update chat contacts
  const loadChatContacts = async () => {
    const token = window.apiService.getToken();
    if (!token) return;

    try {
      const data = await window.apiService.get('/api/users');
      if (data.success) {
        renderChatContacts(data.users);
      }
    } catch (err) {
      console.error('Failed to load chat contacts:', err);
    }
  };

  window.loadChatContacts = loadChatContacts;

  // Search in chat contacts
  const chatSearchInput = document.getElementById('chat-contacts-search');
  if (chatSearchInput) {
    let timeout = null;
    chatSearchInput.addEventListener('input', (e) => {
      clearTimeout(timeout);
      const query = e.target.value.trim();

      timeout = setTimeout(async () => {
        if (!query) {
          loadChatContacts();
          return;
        }

        try {
          const data = await window.apiService.get(`/api/users/search?q=${encodeURIComponent(query)}`);
          if (data.success) {
            renderChatContacts(data.users);
          }
        } catch (err) {
          console.error('Search contacts failed:', err);
        }
      }, 300);
    });
  }

  // Delete Message Confirmation Modal Handlers (Phase 10)
  const deleteModal = document.getElementById('delete-message-modal');
  const deleteCloseBtn = document.getElementById('delete-modal-close-btn');
  const deleteForEveryoneBtn = document.getElementById('delete-for-everyone-btn');
  const deleteForMeBtn = document.getElementById('delete-for-me-btn');
  const deleteCancelBtn = document.getElementById('delete-cancel-btn');

  let activeDeleteMsgId = null;

  const applyMessageDeletedUI = (msgId, type) => {
    const row = document.getElementById(`msg-${msgId}`);
    if (!row) return;

    if (type === 'me') {
      row.remove();
    } else {
      const bubble = row.querySelector('.chat-bubble');
      if (bubble) {
        bubble.className = bubble.className + ' deleted';
        const deleteBtn = row.querySelector('.msg-delete-btn');
        if (deleteBtn) deleteBtn.remove();
        const mediaCard = bubble.querySelector('.chat-media-card');
        if (mediaCard) mediaCard.remove();
        const bubbleText = bubble.querySelector('.chat-bubble-text');
        if (bubbleText) {
          bubbleText.className = 'chat-bubble-text';
          bubbleText.innerHTML = '🚫 This message was deleted';
        } else {
          const newText = document.createElement('div');
          newText.className = 'chat-bubble-text';
          newText.innerHTML = '🚫 This message was deleted';
          bubble.prepend(newText);
        }
        const ticks = bubble.querySelector('.msg-status-tick-container');
        if (ticks) ticks.remove();
      }
    }
  };
  window.applyMessageDeletedUI = applyMessageDeletedUI;

  const openDeleteModal = (msgId, isSender, isGroupAdmin) => {
    activeDeleteMsgId = msgId;
    if (!deleteModal) return;

    if (deleteForEveryoneBtn) {
      deleteForEveryoneBtn.style.display = isSender || isGroupAdmin ? 'flex' : 'none';
    }

    deleteModal.style.display = 'flex';
    deleteModal.classList.add('open');
  };
  window.openDeleteModal = openDeleteModal;

  const closeDeleteModal = () => {
    activeDeleteMsgId = null;
    if (deleteModal) {
      deleteModal.style.display = 'none';
      deleteModal.classList.remove('open');
    }
  };

  if (deleteCloseBtn) deleteCloseBtn.addEventListener('click', closeDeleteModal);
  if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', closeDeleteModal);
  if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) closeDeleteModal();
    });
  }

  if (deleteForEveryoneBtn) {
    deleteForEveryoneBtn.addEventListener('click', async () => {
      if (!activeDeleteMsgId) return;
      const msgId = activeDeleteMsgId;
      closeDeleteModal();

      try {
        const res = await window.apiService.delete(`/api/messages/${msgId}?type=everyone`);
        if (res.success) {
          applyMessageDeletedUI(msgId, 'everyone');
        }
      } catch (err) {
        alert(err.message || 'Failed to delete message for everyone');
      }
    });
  }

  if (deleteForMeBtn) {
    deleteForMeBtn.addEventListener('click', async () => {
      if (!activeDeleteMsgId) return;
      const msgId = activeDeleteMsgId;
      closeDeleteModal();

      try {
        const res = await window.apiService.delete(`/api/messages/${msgId}?type=me`);
        if (res.success) {
          applyMessageDeletedUI(msgId, 'me');
        }
      } catch (err) {
        alert(err.message || 'Failed to delete message for you');
      }
    });
  }

  // Initialize
  if (window.apiService.getToken()) {
    loadChatContacts();
  }

  setupSocketListeners();
});
