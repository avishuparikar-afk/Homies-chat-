const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase11Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 11 COMPLETE FRONTEND REDESIGN TESTS');
  console.log('====================================================');
  let testFailures = 0;

  const assert = (condition, description) => {
    if (condition) {
      console.log(`✅ PASS: ${description}`);
    } else {
      console.error(`❌ FAIL: ${description}`);
      testFailures++;
    }
  };

  const serverScript = path.join(__dirname, '..', 'server', 'server.js');
  console.log(`[Setup] Spawning backend server process: node ${serverScript}`);

  const serverProcess = spawn(process.execPath, [serverScript], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit'
  });

  let socketAlice = null;
  let socketBob = null;

  try {
    // 1. Wait for server readiness
    console.log('[Setup] Waiting for server and MongoDB readiness...');
    let isServerReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://localhost:${config.port}/api/health`);
        if (res.ok) {
          isServerReady = true;
          break;
        }
      } catch (err) {}
      await sleep(500);
    }
    assert(isServerReady, 'Server initialized and responding on HTTP port');

    await mongoose.connect(config.mongoUri);

    // =========================================================================
    // TEST SECTION A: VERIFY FRONTEND REDESIGN ASSETS & LAYOUT ARCHITECTURE
    // =========================================================================
    console.log('\n--- Section A: Frontend Shell, CSS Themes & Redesign Structure ---');

    // 1. Fetch index.html
    const indexRes = await fetch(`http://localhost:${config.port}/`);
    assert(indexRes.status === 200, 'GET / returns 200 OK');
    const indexHtml = await indexRes.text();

    // Verify Desktop & Mobile Shell Elements
    assert(indexHtml.includes('id="app-shell"'), 'index.html contains #app-shell master viewport container');
    assert(indexHtml.includes('id="app-sidebar"'), 'index.html contains #app-sidebar with search, contacts & profile');
    assert(indexHtml.includes('id="app-main-pane"'), 'index.html contains #app-main-pane with header, messages & input');
    assert(indexHtml.includes('id="chat-back-btn"'), 'index.html contains mobile responsive #chat-back-btn');
    assert(indexHtml.includes('class="chat-main-header"'), 'index.html contains modern .chat-main-header');
    assert(indexHtml.includes('id="chat-messages-stream"'), 'index.html contains #chat-messages-stream for message display');
    assert(indexHtml.includes('id="chat-input-form"'), 'index.html contains #chat-input-form with attach & send buttons');

    // Verify Navigation & Profile Dropdown Elements
    assert(indexHtml.includes('id="sidebar-user-menu-btn"'), 'index.html contains user profile summary pill (#sidebar-user-menu-btn)');
    assert(indexHtml.includes('id="profile-dropdown-menu"'), 'index.html contains profile action dropdown menu');
    assert(indexHtml.includes('id="theme-toggle-btn"'), 'index.html contains theme switcher toggle button');
    assert(indexHtml.includes('id="settings-modal"'), 'index.html contains comprehensive Settings modal');

    // Verify Modals for Clean Desktop/Mobile Experience
    assert(indexHtml.includes('id="edit-profile-modal"'), 'index.html contains Edit Profile modal');
    assert(indexHtml.includes('id="view-profile-modal"'), 'index.html contains View Profile modal');
    assert(indexHtml.includes('id="create-group-modal"'), 'index.html contains Create Group modal');
    assert(indexHtml.includes('id="group-info-modal"'), 'index.html contains Group Info modal');
    assert(indexHtml.includes('id="search-modal"'), 'index.html contains Global Search Hub modal');
    assert(indexHtml.includes('id="delete-message-modal"'), 'index.html contains Delete Message Confirmation modal');

    // Verify Script Inclusions
    assert(indexHtml.includes('src="/js/components/theme.controller.js"'), 'index.html includes theme.controller.js');
    assert(indexHtml.includes('src="/js/components/chat.controller.js"'), 'index.html includes chat.controller.js');
    assert(indexHtml.includes('src="/js/components/profile.controller.js"'), 'index.html includes profile.controller.js');
    assert(indexHtml.includes('src="/js/components/group.controller.js"'), 'index.html includes group.controller.js');
    assert(indexHtml.includes('src="/js/components/notification.controller.js"'), 'index.html includes notification.controller.js');
    assert(indexHtml.includes('src="/js/components/search.controller.js"'), 'index.html includes search.controller.js');

    // 2. Fetch variables.css
    const varsRes = await fetch(`http://localhost:${config.port}/css/variables.css`);
    assert(varsRes.status === 200, 'GET /css/variables.css returns 200 OK');
    const varsCss = await varsRes.text();
    assert(varsCss.includes(':root'), 'variables.css specifies :root token engine (dark theme defaults)');
    assert(varsCss.includes('[data-theme="light"]'), 'variables.css specifies [data-theme="light"] overrides');
    assert(varsCss.includes('--accent-color'), 'variables.css defines --accent-color token');
    assert(varsCss.includes('--bg-app'), 'variables.css defines --bg-app layout surface token');
    assert(varsCss.includes('--bubble-sent'), 'variables.css defines --bubble-sent token');

    // 3. Fetch base.css
    const baseRes = await fetch(`http://localhost:${config.port}/css/base.css`);
    assert(baseRes.status === 200, 'GET /css/base.css returns 200 OK');
    const baseCss = await baseRes.text();
    assert(baseCss.includes('skeleton'), 'base.css defines skeleton loading classes');
    assert(baseCss.includes('@keyframes shimmer'), 'base.css defines shimmer animation for smooth skeleton loaders');
    assert(baseCss.includes('.modal-backdrop'), 'base.css defines modal transitions and backdrops');

    // 4. Fetch chat.css
    const chatRes = await fetch(`http://localhost:${config.port}/css/chat.css`);
    assert(chatRes.status === 200, 'GET /css/chat.css returns 200 OK');
    const chatCss = await chatRes.text();
    assert(chatCss.includes('.app-shell'), 'chat.css defines full-height .app-shell flex layout');
    assert(chatCss.includes('@media (max-width: 768px)'), 'chat.css defines mobile responsive breakpoint (<= 768px)');
    assert(chatCss.includes('.mobile-chat-open'), 'chat.css implements mobile slide transition for chat pane');
    assert(chatCss.includes('.message-bubble'), 'chat.css defines message bubble styling');
    assert(chatCss.includes('.status-tick'), 'chat.css defines WhatsApp-style delivery tick badges');

    // =========================================================================
    // TEST SECTION B: BACKEND REGRESSION & CORE FUNCTIONALITY PRESERVATION
    // =========================================================================
    console.log('\n--- Section B: Full Backend & Real-Time Regression Verification ---');

    const timestamp = Date.now();
    const aliceData = {
      username: `p11alice_${timestamp}`,
      email: `p11alice_${timestamp}@example.com`,
      password: 'AlicePassword123!',
      profileImage: '👩'
    };
    const bobData = {
      username: `p11bob_${timestamp}`,
      email: `p11bob_${timestamp}@example.com`,
      password: 'BobPassword123!',
      profileImage: '👨'
    };

    // 1. Register Users
    const regAliceRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aliceData)
    });
    const regAliceJson = await regAliceRes.json();
    assert(regAliceJson.success === true, 'Registered Alice successfully');
    const aliceId = regAliceJson.user._id;
    const aliceToken = regAliceJson.token;

    const regBobRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bobData)
    });
    const regBobJson = await regBobRes.json();
    assert(regBobJson.success === true, 'Registered Bob successfully');
    const bobId = regBobJson.user._id;
    const bobToken = regBobJson.token;

    // 2. Profile APIs
    const profRes = await fetch(`http://localhost:${config.port}/api/users/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ bio: 'Designer & Engineer' })
    });
    const profJson = await profRes.json();
    assert(profJson.success === true && profJson.user.bio === 'Designer & Engineer', 'User profile update works');

    // 3. Connect Sockets for Alice and Bob
    socketAlice = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: aliceToken },
      transports: ['websocket'],
      forceNew: true
    });
    socketBob = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: bobToken },
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise((res) => socketAlice.on('connect', res)),
      new Promise((res) => socketBob.on('connect', res))
    ]);
    assert(socketAlice.connected && socketBob.connected, 'Sockets connected for Alice and Bob');
    await sleep(200);

    // 4. One-to-one real-time message sending & delivery tick update
    let receivedMessageByBob = null;
    socketBob.on('receive-message', (msg) => {
      receivedMessageByBob = msg;
      socketBob.emit('message-read', {
        messageId: msg._id,
        senderId: aliceId
      });
    });

    let statusUpdatedAlice = null;
    socketAlice.on('message-status-updated', (data) => {
      statusUpdatedAlice = data;
    });

    socketAlice.emit('send-message', {
      receiver: bobId,
      text: 'Phase 11 redesign test message'
    });

    await sleep(800);
    assert(receivedMessageByBob !== null, 'Bob received real-time direct message');
    assert(receivedMessageByBob.text === 'Phase 11 redesign test message', 'Message text content verified');
    assert(statusUpdatedAlice !== null && statusUpdatedAlice.status === 'read', 'Alice received status update (read)');

    // 5. Group Chat Verification
    const createGroupRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: 'Design System Team',
        description: 'Phase 11 Redesign Discussion',
        image: '🎨',
        members: [bobId]
      })
    });
    const createGroupJson = await createGroupRes.json();
    assert(createGroupJson.success === true, 'Group created successfully');
    const groupId = createGroupJson.group._id;

    socketBob.emit('join-group', { groupId });
    socketAlice.emit('join-group', { groupId });
    await sleep(200);

    let bobGroupMessageReceived = null;
    socketBob.on('group-message', (msg) => {
      bobGroupMessageReceived = msg;
    });

    socketAlice.emit('group-message', {
      groupId,
      text: 'Welcome to modern UI design system!'
    });

    await sleep(600);
    assert(bobGroupMessageReceived !== null, 'Bob received real-time group message');
    assert(bobGroupMessageReceived.text === 'Welcome to modern UI design system!', 'Group message text matches');

    // 6. Search API Verification
    const searchRes = await fetch(`http://localhost:${config.port}/api/messages/search?q=modern`, {
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    const searchJson = await searchRes.json();
    assert(searchRes.status === 200 && searchJson.success === true, 'Message search endpoint returned 200');
    assert(searchJson.messages && searchJson.messages.length >= 1, 'Search found indexed messages correctly');

    // 7. Message Deletion Verification (Phase 10 integration)
    const directMsgId = receivedMessageByBob._id;
    let deletionSyncedBob = null;
    socketBob.on('message-deleted', (data) => {
      deletionSyncedBob = data;
    });

    const deleteRes = await fetch(`http://localhost:${config.port}/api/messages/${directMsgId}?type=everyone`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${aliceToken}`
      }
    });
    const deleteJson = await deleteRes.json();
    assert(deleteJson.success === true, 'Alice deleted message for everyone');
    assert(deleteJson.deleteType === 'everyone', 'Confirmed deleteType is "everyone"');

    await sleep(400);
    assert(deletionSyncedBob !== null && deletionSyncedBob.messageId === directMsgId, 'Bob received real-time deletion sync event');

    // 8. Notifications API Verification
    const notifRes = await fetch(`http://localhost:${config.port}/api/notifications`, {
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    const notifJson = await notifRes.json();
    assert(notifJson.success === true, 'Notifications API works and Bob has access');

  } catch (err) {
    console.error('Test Execution Error:', err);
    testFailures++;
  } finally {
    if (socketAlice) socketAlice.disconnect();
    if (socketBob) socketBob.disconnect();
    await mongoose.disconnect();

    console.log('[Teardown] Killing spawned server process...');
    serverProcess.kill('SIGINT');
    await sleep(1000);
  }

  console.log('====================================================');
  if (testFailures === 0) {
    console.log('🎉 ALL PHASE 11 TESTS PASSED SUCCESSFULLY! (0 failures)');
    process.exit(0);
  } else {
    console.error(`💥 PHASE 11 COMPLETED WITH ${testFailures} FAILURE(S)`);
    process.exit(1);
  }
}

runPhase11Tests();
