const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase13Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 13 COMPLETE APPLICATION TEST SUITE');
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
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit'
  });

  let socketAlice = null;
  let socketBob = null;
  let socketCharlie = null;

  try {
    // Wait for server readiness
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

    const timestamp = Date.now();
    const aliceData = {
      username: `p13_alice_${timestamp}`,
      email: `p13_alice_${timestamp}@apptest.com`,
      password: 'AliceStrongPass#13',
      bio: 'Alice QA Engineer'
    };
    const bobData = {
      username: `p13_bob_${timestamp}`,
      email: `p13_bob_${timestamp}@apptest.com`,
      password: 'BobStrongPass#13',
      bio: 'Bob System Architect'
    };
    const charlieData = {
      username: `p13_charlie_${timestamp}`,
      email: `p13_charlie_${timestamp}@apptest.com`,
      password: 'CharlieStrongPass#13',
      bio: 'Charlie Security Auditor'
    };

    // =========================================================================
    // 1. AUTH TESTING
    // =========================================================================
    console.log('\n--- 1. AUTH TESTING ---');

    // 1.1 Registration
    const regRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aliceData)
    });
    const regJson = await regRes.json();
    assert(regRes.status === 201 && regJson.success === true, 'AUTH: Registration successful (HTTP 201)');
    const aliceId = regJson.user._id;
    let aliceToken = regJson.token;

    // Duplicate email registration fails
    const dupEmailRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `diff_user_${timestamp}`,
        email: aliceData.email,
        password: 'SomePassword123'
      })
    });
    assert(dupEmailRes.status === 400, 'AUTH: Duplicate email registration rejected (HTTP 400)');

    // Duplicate username registration fails
    const dupUserRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: aliceData.username,
        email: `diff_email_${timestamp}@apptest.com`,
        password: 'SomePassword123'
      })
    });
    assert(dupUserRes.status === 400, 'AUTH: Duplicate username registration rejected (HTTP 400)');

    // Register Bob & Charlie
    const bobRegJson = await (await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bobData)
    })).json();
    const bobId = bobRegJson.user._id;
    const bobToken = bobRegJson.token;

    const charlieRegJson = await (await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charlieData)
    })).json();
    const charlieId = charlieRegJson.user._id;
    const charlieToken = charlieRegJson.token;

    // 1.2 Login
    const loginRes = await fetch(`http://localhost:${config.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: aliceData.email, password: aliceData.password })
    });
    const loginJson = await loginRes.json();
    assert(loginRes.status === 200 && loginJson.success === true && Boolean(loginJson.token), 'AUTH: Login successful with token (HTTP 200)');
    aliceToken = loginJson.token;

    // 1.3 Invalid Credentials
    const badPassRes = await fetch(`http://localhost:${config.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: aliceData.email, password: 'WrongPassword999!' })
    });
    assert(badPassRes.status === 401, 'AUTH: Invalid password rejected (HTTP 401)');

    const badEmailRes = await fetch(`http://localhost:${config.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `nonexistent_${timestamp}@apptest.com`, password: 'SomePassword123' })
    });
    assert(badEmailRes.status === 401, 'AUTH: Unregistered email rejected (HTTP 401)');

    // 1.4 Logout
    const logoutRes = await fetch(`http://localhost:${config.port}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    const logoutJson = await logoutRes.json();
    assert(logoutRes.status === 200 && logoutJson.success === true, 'AUTH: Logout successful (HTTP 200)');

    // =========================================================================
    // 2. CHAT TESTING (One-to-One, Offline, Typing, Delivery States)
    // =========================================================================
    console.log('\n--- 2. CHAT TESTING ---');

    socketAlice = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: aliceToken },
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise((res) => socketAlice.on('connect', res));
    assert(socketAlice.connected, 'CHAT: Alice connected via Socket.IO');

    // 2.1 Offline Messages: Alice sends message to Bob while Bob is OFFLINE
    const offlineMsgText = 'Hello Bob, sending this while you are completely offline!';
    let aliceOfflineSentAck = false;
    let offlineMsgId = null;

    socketAlice.on('message-sent', (data) => {
      if (data.message?.text === offlineMsgText) {
        aliceOfflineSentAck = true;
        offlineMsgId = data.messageId;
      }
    });

    socketAlice.emit('send-message', {
      receiver: bobId,
      text: offlineMsgText
    });
    await sleep(600);

    assert(aliceOfflineSentAck, 'CHAT: Sender receives "message-sent" for offline message');
    const dbOfflineMsg = await mongoose.connection.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(offlineMsgId) });
    assert(dbOfflineMsg !== null && dbOfflineMsg.status === 'sent', 'CHAT: Offline message persisted in MongoDB with status "sent"');

    // Bob retrieves conversation history while coming online
    const bobHistoryRes = await fetch(`http://localhost:${config.port}/api/messages/${aliceId}`, {
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    const bobHistoryJson = await bobHistoryRes.json();
    assert(bobHistoryJson.messages.some((m) => m._id === offlineMsgId), 'CHAT: Bob successfully retrieves offline message from history');

    // 2.2 Bob connects now
    socketBob = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: bobToken },
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise((res) => socketBob.on('connect', res));
    assert(socketBob.connected, 'CHAT: Bob connected via Socket.IO');

    // 2.3 Real-time Send & Receive (Both Online)
    const liveMsgText = 'Hey Bob, now both of us are online in real-time!';
    let bobReceivedLiveMsg = null;
    socketBob.on('receive-message', (msg) => {
      if (msg.text === liveMsgText) {
        bobReceivedLiveMsg = msg;
      }
    });

    socketAlice.emit('send-message', {
      receiver: bobId,
      text: liveMsgText
    });
    await sleep(600);

    assert(bobReceivedLiveMsg !== null, 'CHAT: Bob instantly receives live direct message');
    const liveMsgId = bobReceivedLiveMsg._id;

    // 2.4 Typing and Stop-Typing Indicators
    let bobReceivedTyping = false;
    let bobReceivedStopTyping = false;
    socketBob.on('typing', (data) => {
      if (data.sender === aliceId) bobReceivedTyping = true;
    });
    socketBob.on('stop-typing', (data) => {
      if (data.sender === aliceId) bobReceivedStopTyping = true;
    });

    socketAlice.emit('typing', { receiver: bobId });
    await sleep(200);
    socketAlice.emit('stop-typing', { receiver: bobId });
    await sleep(200);

    assert(bobReceivedTyping, 'CHAT: Bob receives "typing" indicator from Alice');
    assert(bobReceivedStopTyping, 'CHAT: Bob receives "stop-typing" indicator from Alice');

    // 2.5 Delivery States: Sent -> Delivered -> Read
    let aliceDeliveredEvent = false;
    let aliceReadEvent = false;
    socketAlice.on('message-delivered', (data) => {
      if (data.messageId === liveMsgId || data.receiverId === bobId) aliceDeliveredEvent = true;
    });
    socketAlice.on('message-read', (data) => {
      if (data.messageId === liveMsgId || data.readerId === bobId) aliceReadEvent = true;
    });

    // Bob acknowledges delivery
    socketBob.emit('message-delivered', { messageId: liveMsgId, senderId: aliceId });
    await sleep(300);
    assert(aliceDeliveredEvent, 'CHAT: Alice notified that message is DELIVERED');
    const dbDelivMsg = await mongoose.connection.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(liveMsgId) });
    assert(dbDelivMsg.status === 'delivered', 'CHAT: MongoDB message status updated to "delivered"');

    // Bob opens conversation (read)
    socketBob.emit('message-read', { messageId: liveMsgId, senderId: aliceId });
    await sleep(300);
    assert(aliceReadEvent, 'CHAT: Alice notified that message is READ');
    const dbReadMsg = await mongoose.connection.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(liveMsgId) });
    assert(dbReadMsg.status === 'read', 'CHAT: MongoDB message status updated to "read"');

    // =========================================================================
    // 3. GROUP TESTING (Create, Add, Remove, Leave, Messaging)
    // =========================================================================
    console.log('\n--- 3. GROUP TESTING ---');

    socketCharlie = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: charlieToken },
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise((res) => socketCharlie.on('connect', res));

    // 3.1 Create Group
    const createGroupRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: 'Phase 13 Test Group',
        description: 'Comprehensive test group chat',
        image: '🚀',
        members: [bobId]
      })
    });
    const createGroupJson = await createGroupRes.json();
    assert(createGroupRes.status === 201 && createGroupJson.success === true, 'GROUP: Group created successfully (HTTP 201)');
    const groupId = createGroupJson.group._id;

    // Join room for real-time testing
    socketAlice.emit('join-group', { groupId });
    socketBob.emit('join-group', { groupId });
    await sleep(200);

    // 3.2 Add Member (Alice adds Charlie)
    const addMemberRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ userId: charlieId })
    });
    const addMemberJson = await addMemberRes.json();
    assert(addMemberRes.status === 200 && addMemberJson.group.members.some((m) => m._id === charlieId), 'GROUP: Admin adds Charlie as new member (HTTP 200)');
    socketCharlie.emit('join-group', { groupId });
    await sleep(200);

    // 3.3 Group Messaging
    const grpText = 'Welcome all members to Phase 13 group stream!';
    let bobGrpReceived = null;
    let charlieGrpReceived = null;
    socketBob.on('group-message', (m) => {
      if (m.text === grpText) bobGrpReceived = m;
    });
    socketCharlie.on('group-message', (m) => {
      if (m.text === grpText) charlieGrpReceived = m;
    });

    socketAlice.emit('group-message', { groupId, text: grpText });
    await sleep(600);

    assert(bobGrpReceived !== null && charlieGrpReceived !== null, 'GROUP: All members receive real-time group message');

    // 3.4 Remove Member (Alice removes Charlie)
    const removeMemberRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members/${charlieId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    const removeMemberJson = await removeMemberRes.json();
    assert(removeMemberRes.status === 200 && !removeMemberJson.group.members.some((m) => m._id === charlieId), 'GROUP: Admin removes member Charlie (HTTP 200)');

    // 3.5 Leave Group (Bob voluntarily leaves)
    const leaveRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members/${bobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    const leaveJson = await leaveRes.json();
    assert(leaveRes.status === 200 && !leaveJson.group.members.some((m) => m._id === bobId), 'GROUP: Bob successfully leaves the group (HTTP 200)');

    // =========================================================================
    // 4. FILES TESTING (Image, Document, Invalid, Large)
    // =========================================================================
    console.log('\n--- 4. FILES TESTING ---');

    // 4.1 Image Upload (PNG)
    const imgFormData = new FormData();
    const pngBlob = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
    imgFormData.append('file', pngBlob, 'app_test_screenshot.png');
    imgFormData.append('conversationType', 'direct');
    imgFormData.append('recipientId', bobId);

    const imgUploadRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: imgFormData
    });
    const imgUploadJson = await imgUploadRes.json();
    assert(imgUploadRes.status === 201 && imgUploadJson.file.fileType === 'image', 'FILES: Image (PNG) upload successful (HTTP 201)');
    const uploadedImgName = imgUploadJson.file.fileName;

    // View image inline
    const viewImgRes = await fetch(`http://localhost:${config.port}/api/files/view/${uploadedImgName}`, {
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    assert(viewImgRes.status === 200 && viewImgRes.headers.get('content-type').includes('image/png'), 'FILES: Image accessible with correct MIME type');

    // 4.2 Document Upload (PDF)
    const docFormData = new FormData();
    const pdfBlob = new Blob(['%PDF-1.4 sample PDF document content'], { type: 'application/pdf' });
    docFormData.append('file', pdfBlob, 'project_spec.pdf');
    docFormData.append('conversationType', 'direct');
    docFormData.append('recipientId', bobId);

    const docUploadRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: docFormData
    });
    const docUploadJson = await docUploadRes.json();
    assert(docUploadRes.status === 201 && docUploadJson.file.fileType === 'file', 'FILES: Document (PDF) upload successful (HTTP 201)');

    // 4.3 Invalid File (Dangerous script / executable)
    const badFileFormData = new FormData();
    const shBlob = new Blob(['#!/bin/bash\nrm -rf /'], { type: 'text/plain' });
    badFileFormData.append('file', shBlob, 'malicious_script.sh');

    const badFileUploadRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: badFileFormData
    });
    assert(badFileUploadRes.status === 400, 'FILES: Dangerous file type (.sh) rejected (HTTP 400)');

    // 4.4 Large File (> 10MB)
    const largeFormData = new FormData();
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11 MB
    const largeBlob = new Blob([largeBuffer], { type: 'application/pdf' });
    largeFormData.append('file', largeBlob, 'oversized_document.pdf');

    const largeUploadRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: largeFormData
    });
    const largeUploadJson = await largeUploadRes.json();
    assert(
      largeUploadRes.status === 400 && largeUploadJson.message.toLowerCase().includes('10mb'),
      'FILES: Oversized file (> 10MB) rejected with limit message (HTTP 400)'
    );

    // =========================================================================
    // 5. MESSAGES TESTING (Delete & Search)
    // =========================================================================
    console.log('\n--- 5. MESSAGES TESTING ---');

    // 5.1 Message Deletion ("Delete for me" vs "Delete for everyone")
    // Alice sends message to Bob
    const msgToDelete = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceId),
      receiver: new mongoose.Types.ObjectId(bobId),
      groupId: null,
      text: 'Secret message to test deletion',
      messageType: 'text',
      status: 'delivered',
      deletedFor: [],
      isDeletedForEveryone: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const delMsgId = msgToDelete.insertedId.toString();

    // Alice deletes for everyone
    let bobSyncDeleted = null;
    socketBob.on('message-deleted', (d) => {
      if (d.messageId === delMsgId) bobSyncDeleted = d;
    });

    const delEveryoneRes = await fetch(`http://localhost:${config.port}/api/messages/${delMsgId}?type=everyone`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    const delEveryoneJson = await delEveryoneRes.json();
    assert(delEveryoneRes.status === 200 && delEveryoneJson.deleteType === 'everyone', 'MESSAGES: Message deleted for everyone (HTTP 200)');
    await sleep(400);

    assert(bobSyncDeleted !== null && bobSyncDeleted.message.text === 'This message was deleted', 'MESSAGES: Socket.IO synced deletion with placeholder text');

    // 5.2 Message Search
    // Create indexed message
    await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceId),
      receiver: new mongoose.Types.ObjectId(bobId),
      groupId: null,
      text: 'Searching for cryptography algorithms in real-time chat',
      messageType: 'text',
      status: 'delivered',
      deletedFor: [],
      isDeletedForEveryone: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const searchRes = await fetch(`http://localhost:${config.port}/api/messages/search?q=cryptography`, {
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    const searchJson = await searchRes.json();
    assert(searchRes.status === 200 && searchJson.messages.length >= 1, 'MESSAGES: Search query found message containing "cryptography"');

    // =========================================================================
    // 6. UI TESTING (Desktop, Mobile, Dark & Light Mode)
    // =========================================================================
    console.log('\n--- 6. UI TESTING ---');

    const htmlRes = await fetch(`http://localhost:${config.port}/`);
    const htmlText = await htmlRes.text();

    // Desktop UI
    assert(htmlText.includes('class="app-shell"'), 'UI: Desktop shell container (.app-shell) rendered');
    assert(htmlText.includes('class="app-sidebar"'), 'UI: Sidebar pane (.app-sidebar) rendered');
    assert(htmlText.includes('class="app-main-pane"'), 'UI: Main chat pane (.app-main-pane) rendered');
    assert(htmlText.includes('id="chat-messages-stream"'), 'UI: Message stream (#chat-messages-stream) rendered');

    // Mobile UI
    assert(htmlText.includes('id="chat-back-btn"'), 'UI: Mobile back navigation button (#chat-back-btn) rendered');
    const chatCss = await (await fetch(`http://localhost:${config.port}/css/chat.css`)).text();
    assert(chatCss.includes('@media (max-width: 768px)'), 'UI: Mobile media query breakpoint (<= 768px) defined');
    assert(chatCss.includes('.mobile-chat-open'), 'UI: Mobile view toggle class (.mobile-chat-open) defined');

    // Dark & Light Mode
    const varsCss = await (await fetch(`http://localhost:${config.port}/css/variables.css`)).text();
    assert(varsCss.includes(':root') && varsCss.includes('--bg-app'), 'UI: Dark mode design system variables defined in :root');
    assert(varsCss.includes('[data-theme="light"]'), 'UI: Light mode design system overrides defined in [data-theme="light"]');

    // =========================================================================
    // 7. SECURITY TESTING
    // =========================================================================
    console.log('\n--- 7. SECURITY TESTING ---');

    // 7.1 Unauthorized API Request (no token)
    const anonReq = await fetch(`http://localhost:${config.port}/api/users`);
    assert(anonReq.status === 401, 'SECURITY: Unauthorized API request rejected (HTTP 401)');

    // 7.2 Invalid JWT
    const badJwtReq = await fetch(`http://localhost:${config.port}/api/users`, {
      headers: { Authorization: 'Bearer this.is.an.invalid.jwt.token' }
    });
    assert(badJwtReq.status === 401, 'SECURITY: Invalid JWT rejected (HTTP 401)');

    // 7.3 Unauthorized Group Modification (non-admin tries to edit group)
    const unauthGrpMod = await fetch(`http://localhost:${config.port}/api/groups/${groupId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${charlieToken}`
      },
      body: JSON.stringify({ name: 'Unauthorized Renamed Group' })
    });
    assert(unauthGrpMod.status === 403, 'SECURITY: Unauthorized group edit rejected with HTTP 403 Forbidden');

    // 7.4 Unauthorized Message Deletion (Charlie tries to delete Alice's message for everyone)
    const unauthDel = await fetch(`http://localhost:${config.port}/api/messages/${liveMsgId}?type=everyone`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${charlieToken}` }
    });
    assert(unauthDel.status === 403, 'SECURITY: Unauthorized message deletion rejected with HTTP 403 Forbidden');

  } catch (err) {
    console.error('Test Execution Error:', err);
    testFailures++;
  } finally {
    if (socketAlice) socketAlice.disconnect();
    if (socketBob) socketBob.disconnect();
    if (socketCharlie) socketCharlie.disconnect();
    await mongoose.disconnect();

    console.log('[Teardown] Killing spawned server process...');
    serverProcess.kill('SIGINT');
    await sleep(1000);
  }

  console.log('====================================================');
  if (testFailures === 0) {
    console.log('🎉 ALL PHASE 13 TESTS PASSED SUCCESSFULLY! (0 failures)');
    process.exit(0);
  } else {
    console.error(`💥 PHASE 13 TEST SUITE FINISHED WITH ${testFailures} FAILURE(S)`);
    process.exit(1);
  }
}

runPhase13Tests();
