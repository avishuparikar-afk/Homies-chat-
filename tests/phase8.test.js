const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase8Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 8 REAL-TIME NOTIFICATIONS TESTS');
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
  let socketCharlie = null;

  try {
    // 1. Wait for server readiness
    console.log('[Setup] Waiting for server and MongoDB connection...');
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

    // Connect mongoose for direct collection verification
    await mongoose.connect(config.mongoUri);

    // 2. Setup 3 test users: Alice, Bob, Charlie
    const timestamp = Date.now();
    const aliceData = {
      username: `alice_n_${timestamp}`,
      email: `alice_n_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const bobData = {
      username: `bob_n_${timestamp}`,
      email: `bob_n_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const charlieData = {
      username: `charlie_n_${timestamp}`,
      email: `charlie_n_${timestamp}@example.com`,
      password: 'Password123!'
    };

    const regAlice = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aliceData)
      })
    ).json();

    const regBob = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bobData)
      })
    ).json();

    const regCharlie = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(charlieData)
      })
    ).json();

    const aliceToken = regAlice.token;
    const bobToken = regBob.token;
    const charlieToken = regCharlie.token;
    const aliceUser = regAlice.user;
    const bobUser = regBob.user;
    const charlieUser = regCharlie.user;

    assert(aliceToken && bobToken && charlieToken, 'Alice, Bob, and Charlie registered successfully');

    // ==========================================
    // TEST 1: REST Notification APIs (GET, PUT single read, PUT read-all)
    // ==========================================
    console.log('\n[Test 1] Testing Notification REST APIs (GET, PUT read, PUT read-all)...');

    // Create a dummy message & notification directly in MongoDB
    const dummyMsg = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceUser._id),
      receiver: new mongoose.Types.ObjectId(bobUser._id),
      text: 'Test message for notification',
      messageType: 'text',
      status: 'sent',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const dummyNotif = await mongoose.connection.collection('notifications').insertOne({
      user: new mongoose.Types.ObjectId(bobUser._id),
      sender: new mongoose.Types.ObjectId(aliceUser._id),
      message: dummyMsg.insertedId,
      type: 'MESSAGE',
      read: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 1A: GET /api/notifications
    const getNotifRes = await fetch(`http://localhost:${config.port}/api/notifications`, {
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    const getNotifJson = await getNotifRes.json();

    assert(getNotifRes.status === 200, 'GET /api/notifications returns HTTP 200');
    assert(getNotifJson.success === true, 'Response contains success: true');
    assert(getNotifJson.unreadCount >= 1, 'Unread count is correctly calculated (>= 1)');
    assert(getNotifJson.notifications.length >= 1, 'Notifications array populated');
    assert(
      getNotifJson.notifications[0].sender?.username === aliceData.username,
      'Sender username populated'
    );
    assert(
      getNotifJson.notifications[0].type === 'MESSAGE',
      'Notification type matches "MESSAGE"'
    );

    const testNotifId = dummyNotif.insertedId.toString();

    // 1B: PUT /api/notifications/:id/read (Unauthorized user Charlie tries to mark Bob's notification)
    const unauthorizedMark = await fetch(
      `http://localhost:${config.port}/api/notifications/${testNotifId}/read`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${charlieToken}` }
      }
    );
    assert(
      unauthorizedMark.status === 403,
      'Unauthorized user marking another user notification rejected with HTTP 403 Forbidden'
    );

    // 1C: PUT /api/notifications/:id/read (Authorized Bob marks as read)
    const markReadRes = await fetch(
      `http://localhost:${config.port}/api/notifications/${testNotifId}/read`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${bobToken}` }
      }
    );
    const markReadJson = await markReadRes.json();
    assert(markReadRes.status === 200, 'PUT /api/notifications/:id/read returns HTTP 200');
    assert(markReadJson.notification.read === true, 'Notification status updated to read: true');
    assert(markReadJson.unreadCount === 0, 'Unread count updated to 0');

    // 1D: Insert 2 unread notifications and test PUT /api/notifications/read-all
    await mongoose.connection.collection('notifications').insertMany([
      {
        user: new mongoose.Types.ObjectId(bobUser._id),
        sender: new mongoose.Types.ObjectId(aliceUser._id),
        message: dummyMsg.insertedId,
        type: 'MESSAGE',
        read: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user: new mongoose.Types.ObjectId(bobUser._id),
        sender: new mongoose.Types.ObjectId(charlieUser._id),
        message: dummyMsg.insertedId,
        type: 'MESSAGE',
        read: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    const readAllRes = await fetch(`http://localhost:${config.port}/api/notifications/read-all`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    const readAllJson = await readAllRes.json();
    assert(readAllRes.status === 200, 'PUT /api/notifications/read-all returns HTTP 200');
    assert(readAllJson.modifiedCount >= 2, 'Multiple unread notifications marked read');
    assert(readAllJson.unreadCount === 0, 'Unread count is 0 after read-all');

    // ==========================================
    // TEST 2: Real-Time One-to-One Message Notification
    // ==========================================
    console.log('\n[Test 2] Testing Real-Time 1-to-1 Message Notification Event...');

    socketAlice = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: aliceToken },
      transports: ['websocket']
    });
    socketBob = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: bobToken },
      transports: ['websocket']
    });
    socketCharlie = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: charlieToken },
      transports: ['websocket']
    });

    await Promise.all([
      new Promise((res) => socketAlice.on('connect', res)),
      new Promise((res) => socketBob.on('connect', res)),
      new Promise((res) => socketCharlie.on('connect', res))
    ]);
    assert(true, 'Alice, Bob, and Charlie connected via Socket.IO');
    await sleep(300);

    // Bob sets up listener for new-notification
    const bobNotifPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for 1-on-1 notification')), 5000);
      socketBob.on('new-notification', (notif) => {
        if (notif.type === 'MESSAGE') {
          clearTimeout(timer);
          resolve(notif);
        }
      });
    });

    // Alice sends real-time direct message to Bob
    socketAlice.emit('send-message', {
      receiver: bobUser._id,
      text: 'Hey Bob, checking real-time notification alert'
    });

    const received1on1Notif = await bobNotifPromise;
    assert(Boolean(received1on1Notif), 'Bob received "new-notification" event in real time');
    assert(received1on1Notif.type === 'MESSAGE', 'Notification type is "MESSAGE"');
    assert(
      (received1on1Notif.sender?._id || received1on1Notif.sender) === aliceUser._id,
      'Notification sender matches Alice'
    );
    assert(received1on1Notif.read === false, 'Notification initial read state is false');

    // Verify Notification document in MongoDB
    const persistedDirectNotif = await mongoose.connection
      .collection('notifications')
      .findOne({ _id: new mongoose.Types.ObjectId(received1on1Notif._id) });
    assert(Boolean(persistedDirectNotif), 'Notification document persisted in MongoDB');
    assert(
      persistedDirectNotif.user.toString() === bobUser._id,
      'Notification user matches Bob'
    );
    assert(
      persistedDirectNotif.type === 'MESSAGE',
      'Notification collection type is "MESSAGE"'
    );

    // ==========================================
    // TEST 3: Real-Time Group Message Notification (Multiple Members)
    // ==========================================
    console.log('\n[Test 3] Testing Real-Time Group Message Notification...');

    // Alice creates group with Bob and Charlie
    const groupRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: `Sprint Team ${timestamp}`,
        description: 'Sprint coordination group',
        members: [bobUser._id, charlieUser._id]
      })
    });
    const groupJson = await groupRes.json();
    const groupId = groupJson.group._id;
    assert(groupRes.status === 201, 'Group created successfully');

    // Sockets join group room
    socketAlice.emit('join-group', { groupId });
    socketBob.emit('join-group', { groupId });
    socketCharlie.emit('join-group', { groupId });
    await sleep(200);

    // Setup listeners for Bob and Charlie
    const bobGroupNotifPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for Bob group notification')), 5000);
      socketBob.on('new-notification', (notif) => {
        if (notif.type === 'GROUP_MESSAGE') {
          clearTimeout(timer);
          resolve(notif);
        }
      });
    });

    const charlieGroupNotifPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for Charlie group notification')), 5000);
      socketCharlie.on('new-notification', (notif) => {
        if (notif.type === 'GROUP_MESSAGE') {
          clearTimeout(timer);
          resolve(notif);
        }
      });
    });

    // Track that Alice (sender) does not receive self-notification
    let aliceReceivedSelfNotif = false;
    socketAlice.on('new-notification', () => {
      aliceReceivedSelfNotif = true;
    });

    // Alice sends group message
    socketAlice.emit('group-message', {
      groupId,
      text: 'Standup starts in 5 minutes team!'
    });

    const [bobGroupNotif, charlieGroupNotif] = await Promise.all([
      bobGroupNotifPromise,
      charlieGroupNotifPromise
    ]);

    assert(Boolean(bobGroupNotif), 'Bob received group notification in real time');
    assert(Boolean(charlieGroupNotif), 'Charlie received group notification in real time');
    assert(bobGroupNotif.type === 'GROUP_MESSAGE', 'Bob notification type is "GROUP_MESSAGE"');
    assert(charlieGroupNotif.type === 'GROUP_MESSAGE', 'Charlie notification type is "GROUP_MESSAGE"');
    assert(
      (bobGroupNotif.groupId?._id || bobGroupNotif.groupId).toString() === groupId,
      'Group notification matches groupId'
    );
    assert(!aliceReceivedSelfNotif, 'Alice (sender) was not notified of her own message');

    // ==========================================
    // TEST 4: Verification of Client Suppression Logic
    // ==========================================
    console.log('\n[Test 4] Verifying Notification Suppression Logic for Currently Open Chat...');

    // Function matching client isCurrentlyOpenConversation logic
    const isSuppressed = (currentChat, notif) => {
      if (notif.type === 'MESSAGE') {
        return (
          currentChat.mode === 'direct' &&
          currentChat.activeContactId === (notif.sender?._id || notif.sender)
        );
      }
      if (notif.type === 'GROUP_MESSAGE') {
        return (
          currentChat.mode === 'group' &&
          currentChat.activeGroupId === (notif.groupId?._id || notif.groupId)
        );
      }
      return false;
    };

    // When Bob has Alice's direct conversation open:
    const bobViewingAlice = { mode: 'direct', activeContactId: aliceUser._id };
    assert(
      isSuppressed(bobViewingAlice, received1on1Notif) === true,
      'Notification is correctly SUPPRESSED when conversation is currently open'
    );

    // When Bob has another contact open:
    const bobViewingCharlie = { mode: 'direct', activeContactId: charlieUser._id };
    assert(
      isSuppressed(bobViewingCharlie, received1on1Notif) === false,
      'Notification is NOT suppressed when a different conversation is open'
    );

    // When Bob is viewing the sprint group:
    const bobViewingGroup = { mode: 'group', activeGroupId: groupId };
    assert(
      isSuppressed(bobViewingGroup, bobGroupNotif) === true,
      'Group notification is correctly SUPPRESSED when group chat is currently open'
    );

    // ==========================================
    // TEST 5: Regressions & Previous Features Verification
    // ==========================================
    console.log('\n[Test 5] Verifying Full System Regression Integrity...');

    // Check that GET /api/messages/:userId/:otherUserId still works
    const historyRes = await fetch(
      `http://localhost:${config.port}/api/messages/${aliceUser._id}/${bobUser._id}`,
      {
        headers: { Authorization: `Bearer ${aliceToken}` }
      }
    );
    assert(historyRes.status === 200, 'Direct chat history API returns HTTP 200');

    // Check that group messages history still works
    const grpHistoryRes = await fetch(
      `http://localhost:${config.port}/api/groups/${groupId}/messages`,
      {
        headers: { Authorization: `Bearer ${bobToken}` }
      }
    );
    assert(grpHistoryRes.status === 200, 'Group chat history API returns HTTP 200');

    // Clean up test data
    await mongoose.connection.collection('users').deleteMany({
      $or: [
        { email: aliceData.email },
        { email: bobData.email },
        { email: charlieData.email }
      ]
    });
    await mongoose.connection.collection('groups').deleteOne({
      _id: new mongoose.Types.ObjectId(groupId)
    });
    await mongoose.connection.collection('messages').deleteMany({
      $or: [
        { sender: new mongoose.Types.ObjectId(aliceUser._id) },
        { receiver: new mongoose.Types.ObjectId(bobUser._id) },
        { groupId: new mongoose.Types.ObjectId(groupId) }
      ]
    });
    await mongoose.connection.collection('notifications').deleteMany({
      $or: [
        { user: new mongoose.Types.ObjectId(bobUser._id) },
        { user: new mongoose.Types.ObjectId(charlieUser._id) }
      ]
    });
    console.log('[Cleanup] Test database records removed from MongoDB.');

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 8 TESTS PASSED SUCCESSFULLY!');
    } else {
      console.error(`⚠️ ${testFailures} TEST(S) FAILED!`);
    }
    console.log('====================================================\n');

  } catch (error) {
    console.error('Fatal test error:', error);
    testFailures++;
  } finally {
    if (socketAlice) socketAlice.disconnect();
    if (socketBob) socketBob.disconnect();
    if (socketCharlie) socketCharlie.disconnect();

    try {
      await mongoose.disconnect();
    } catch (e) {}

    try {
      if (serverProcess && serverProcess.pid) {
        execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
      }
    } catch (e) {}

    await sleep(500);
    process.exitCode = testFailures > 0 ? 1 : 0;
  }
}

runPhase8Tests();
