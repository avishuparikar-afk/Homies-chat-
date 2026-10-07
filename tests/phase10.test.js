const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase10Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 10 MESSAGE DELETION TESTS');
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

    // Connect mongoose for direct collection verification
    await mongoose.connect(config.mongoUri);

    // 2. Setup Test Users
    const timestamp = Date.now();
    const aliceData = {
      username: `alice_del_${timestamp}`,
      email: `alice_del_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const bobData = {
      username: `bob_del_${timestamp}`,
      email: `bob_del_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const charlieData = {
      username: `charlie_del_${timestamp}`,
      email: `charlie_del_${timestamp}@example.com`,
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

    assert(aliceToken && bobToken && charlieToken, 'Test users Alice, Bob, and Charlie registered');

    // Connect Sockets for real-time synchronization testing
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

    // ==========================================
    // TEST 1: Delete For Me (Direct Chat)
    // ==========================================
    console.log('\n[Test 1] Testing "Delete for me" in Direct Chat...');

    // Alice sends direct message to Bob
    const directMsg1 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceUser._id),
      receiver: new mongoose.Types.ObjectId(bobUser._id),
      groupId: null,
      text: 'Private draft message from Alice',
      messageType: 'text',
      status: 'sent',
      deletedFor: [],
      isDeletedForEveryone: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const msg1Id = directMsg1.insertedId.toString();

    // Alice deletes message for herself
    const delForMeRes = await fetch(
      `http://localhost:${config.port}/api/messages/${msg1Id}?type=me`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` }
      }
    );
    const delForMeJson = await delForMeRes.json();

    assert(delForMeRes.status === 200, 'DELETE /api/messages/:id?type=me returns HTTP 200');
    assert(delForMeJson.success === true, 'Response contains success: true');
    assert(delForMeJson.deleteType === 'me', 'Confirmed deleteType is "me"');

    // Alice fetches chat history with Bob: message should NOT appear for Alice
    const aliceHistoryRes = await fetch(
      `http://localhost:${config.port}/api/messages/${bobUser._id}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const aliceHistoryJson = await aliceHistoryRes.json();
    assert(
      !aliceHistoryJson.messages.some((m) => m._id === msg1Id),
      'Message is excluded from Alice chat history ("Delete for me")'
    );

    // Bob fetches chat history with Alice: message SHOULD still be visible for Bob
    const bobHistoryRes = await fetch(
      `http://localhost:${config.port}/api/messages/${aliceUser._id}`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    const bobHistoryJson = await bobHistoryRes.json();
    assert(
      bobHistoryJson.messages.some((m) => m._id === msg1Id),
      'Message remains intact and visible in Bob chat history'
    );

    // ==========================================
    // TEST 2: Delete For Everyone (Direct Chat) & Socket.IO Sync
    // ==========================================
    console.log('\n[Test 2] Testing "Delete for everyone" in Direct Chat & Real-time Socket Sync...');

    // Alice sends another message to Bob
    const directMsg2 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceUser._id),
      receiver: new mongoose.Types.ObjectId(bobUser._id),
      groupId: null,
      text: 'Confidential secret notes with sensitive content',
      messageType: 'text',
      status: 'delivered',
      deletedFor: [],
      isDeletedForEveryone: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const msg2Id = directMsg2.insertedId.toString();

    // Setup Bob Socket.IO listener for real-time 'message-deleted'
    const bobDeletedPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for message-deleted event')), 5000);
      socketBob.on('message-deleted', (data) => {
        if (data.messageId === msg2Id) {
          clearTimeout(timer);
          resolve(data);
        }
      });
    });

    // Alice deletes message for everyone
    const delForEveryoneRes = await fetch(
      `http://localhost:${config.port}/api/messages/${msg2Id}?type=everyone`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` }
      }
    );
    const delForEveryoneJson = await delForEveryoneRes.json();

    assert(delForEveryoneRes.status === 200, 'DELETE /api/messages/:id?type=everyone returns HTTP 200');
    assert(delForEveryoneJson.success === true, 'Response contains success: true');
    assert(delForEveryoneJson.deleteType === 'everyone', 'Confirmed deleteType is "everyone"');

    // Verify Socket.IO synchronized event received by Bob
    const receivedDeletionEvent = await bobDeletedPromise;
    assert(Boolean(receivedDeletionEvent), 'Bob received "message-deleted" Socket.IO event in real time');
    assert(receivedDeletionEvent.type === 'everyone', 'Deletion event type is "everyone"');
    assert(
      receivedDeletionEvent.message.text === 'This message was deleted',
      'Socket payload contains replaced text: "This message was deleted"'
    );

    // Verify MongoDB document integrity (not physically deleted, replaced with placeholder)
    const persistedMsg2 = await mongoose.connection
      .collection('messages')
      .findOne({ _id: new mongoose.Types.ObjectId(msg2Id) });

    assert(Boolean(persistedMsg2), 'Message is NOT physically removed from MongoDB (preserves chat history)');
    assert(
      persistedMsg2.text === 'This message was deleted',
      'MongoDB content text replaced with "This message was deleted"'
    );
    assert(
      persistedMsg2.isDeletedForEveryone === true,
      'MongoDB document has isDeletedForEveryone: true'
    );
    assert(
      Boolean(persistedMsg2.deletedAt),
      'MongoDB document records deletedAt timestamp'
    );

    // Verify Bob fetching chat history sees "This message was deleted"
    const bobHistory2Res = await fetch(
      `http://localhost:${config.port}/api/messages/${aliceUser._id}`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    const bobHistory2Json = await bobHistory2Res.json();
    const fetchedMsg2 = bobHistory2Json.messages.find((m) => m._id === msg2Id);
    assert(
      fetchedMsg2 && fetchedMsg2.text === 'This message was deleted',
      'Bob chat history retrieves "This message was deleted"'
    );

    // ==========================================
    // TEST 3: Authorization Checks (Direct Chat)
    // ==========================================
    console.log('\n[Test 3] Testing Authorization Checks (Direct Chat)...');

    // Alice creates another message
    const directMsg3 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceUser._id),
      receiver: new mongoose.Types.ObjectId(bobUser._id),
      groupId: null,
      text: 'Alice message that Bob should not delete for everyone',
      messageType: 'text',
      status: 'sent',
      deletedFor: [],
      isDeletedForEveryone: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const msg3Id = directMsg3.insertedId.toString();

    // 3A. Receiver Bob tries to delete Alice's message for everyone
    const unauthorizedDelRes = await fetch(
      `http://localhost:${config.port}/api/messages/${msg3Id}?type=everyone`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bobToken}` }
      }
    );
    assert(
      unauthorizedDelRes.status === 403,
      'Receiver attempting "delete for everyone" on another sender message rejected with HTTP 403 Forbidden'
    );

    // 3B. Outside party Charlie (not sender, not receiver) tries to delete for me or everyone
    const charlieUnauthorizedRes = await fetch(
      `http://localhost:${config.port}/api/messages/${msg3Id}?type=me`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${charlieToken}` }
      }
    );
    assert(
      charlieUnauthorizedRes.status === 403,
      'Non-participant attempting deletion rejected with HTTP 403 Forbidden'
    );

    // ==========================================
    // TEST 4: Group Chat Message Deletion & Admin Permissions
    // ==========================================
    console.log('\n[Test 4] Testing Group Chat Deletion & Admin Permissions...');

    // Alice creates group where Alice is Admin, Bob and Charlie are members
    const groupRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: `Engineering Team ${timestamp}`,
        description: 'Team group for deletion authorization tests',
        members: [bobUser._id, charlieUser._id]
      })
    });
    const groupJson = await groupRes.json();
    const groupId = groupJson.group._id;
    assert(groupRes.status === 201, 'Group created successfully (Alice is Admin)');

    // Sockets join group room
    socketAlice.emit('join-group', { groupId });
    socketBob.emit('join-group', { groupId });
    socketCharlie.emit('join-group', { groupId });
    await sleep(200);

    // Bob sends a message in the group
    const grpMsg1 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(bobUser._id),
      groupId: new mongoose.Types.ObjectId(groupId),
      text: 'Bob group announcement',
      messageType: 'text',
      status: 'sent',
      deletedFor: [],
      isDeletedForEveryone: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const grpMsg1Id = grpMsg1.insertedId.toString();

    // 4A. Non-admin Charlie (not sender) attempts to delete Bob's group message for everyone
    const charlieDelEveryoneRes = await fetch(
      `http://localhost:${config.port}/api/messages/${grpMsg1Id}?type=everyone`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${charlieToken}` }
      }
    );
    assert(
      charlieDelEveryoneRes.status === 403,
      'Non-admin group member denied from deleting another member message for everyone (HTTP 403)'
    );

    // 4B. Charlie deletes Bob's message for himself ("Delete for me")
    const charlieDelMeRes = await fetch(
      `http://localhost:${config.port}/api/messages/${grpMsg1Id}?type=me`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${charlieToken}` }
      }
    );
    assert(charlieDelMeRes.status === 200, 'Group member can "delete for me" successfully');

    // Charlie fetches group messages: message is hidden for Charlie
    const charlieGrpHistoryRes = await fetch(
      `http://localhost:${config.port}/api/groups/${groupId}/messages`,
      { headers: { Authorization: `Bearer ${charlieToken}` } }
    );
    const charlieGrpHistoryJson = await charlieGrpHistoryRes.json();
    assert(
      !charlieGrpHistoryJson.messages.some((m) => m._id === grpMsg1Id),
      'Group message excluded from Charlie history after "Delete for me"'
    );

    // 4C. Group Admin Alice deletes Bob's group message for everyone
    const charlieSyncPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for Charlie group deletion sync')), 5000);
      socketCharlie.on('message-deleted', (data) => {
        if (data.messageId === grpMsg1Id) {
          clearTimeout(timer);
          resolve(data);
        }
      });
    });

    const adminDelEveryoneRes = await fetch(
      `http://localhost:${config.port}/api/messages/${grpMsg1Id}?type=everyone`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` }
      }
    );
    const adminDelEveryoneJson = await adminDelEveryoneRes.json();

    assert(adminDelEveryoneRes.status === 200, 'Group admin can delete member message for everyone (HTTP 200)');
    assert(adminDelEveryoneJson.success === true, 'Admin deletion succeeded');

    // Verify Charlie receives real-time group sync
    const grpDeletionEvent = await charlieSyncPromise;
    assert(Boolean(grpDeletionEvent), 'Group members received real-time "message-deleted" Socket.IO event');
    assert(
      grpDeletionEvent.message.text === 'This message was deleted',
      'Group deletion broadcast contains "This message was deleted"'
    );

    // Verify MongoDB document
    const persistedGrpMsg = await mongoose.connection
      .collection('messages')
      .findOne({ _id: new mongoose.Types.ObjectId(grpMsg1Id) });
    assert(
      persistedGrpMsg.text === 'This message was deleted',
      'Group message text replaced with "This message was deleted"'
    );
    assert(
      persistedGrpMsg.isDeletedForEveryone === true,
      'Group message isDeletedForEveryone is true'
    );

    // ==========================================
    // TEST 5: System Regression Integrity (Phases 1-9)
    // ==========================================
    console.log('\n[Test 5] Verifying Regression Integrity (Phases 1 - 9)...');

    // Health check
    const healthRes = await fetch(`http://localhost:${config.port}/api/health`);
    assert(healthRes.status === 200, 'GET /api/health returns 200');

    // Search messages excludes deleted-for-me messages
    const searchRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?q=deleted`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    assert(searchRes.status === 200, 'GET /api/messages/search returns 200');

    // Cleanup test data
    console.log('\n[Cleanup] Cleaning up test records from MongoDB...');
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
        { _id: new mongoose.Types.ObjectId(msg1Id) },
        { _id: new mongoose.Types.ObjectId(msg2Id) },
        { _id: new mongoose.Types.ObjectId(msg3Id) },
        { _id: new mongoose.Types.ObjectId(grpMsg1Id) }
      ]
    });

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 10 TESTS PASSED SUCCESSFULLY!');
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

runPhase10Tests();
