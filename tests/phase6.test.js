const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase6Tests() {
  console.log('====================================================');
  console.log('    STARTING PHASE 6 GROUP CHAT (3-USER) TESTS');
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
    // Wait for server to start
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

    // Connect mongoose
    await mongoose.connect(config.mongoUri);

    // Setup 3 test users: Alice, Bob, Charlie
    const timestamp = Date.now();
    const aliceData = {
      username: `alice_g_${timestamp}`,
      email: `alice_g_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const bobData = {
      username: `bob_g_${timestamp}`,
      email: `bob_g_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const charlieData = {
      username: `charlie_g_${timestamp}`,
      email: `charlie_g_${timestamp}@example.com`,
      password: 'Password123!'
    };

    const regA = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aliceData)
      })
    ).json();
    const tokenA = regA.token;
    const userA = regA.user;

    const regB = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bobData)
      })
    ).json();
    const tokenB = regB.token;
    const userB = regB.user;

    const regC = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(charlieData)
      })
    ).json();
    const tokenC = regC.token;
    const userC = regC.user;

    assert(tokenA && tokenB && tokenC, '3 Users (Alice, Bob, Charlie) registered successfully');

    // --- TEST 1: POST /api/groups (Create Group) ---
    console.log('\n[Test 1] Testing POST /api/groups (Create Group)...');
    const groupName = 'Tech Innovators';
    const groupDesc = 'Building innovative software together';
    const groupImg = '🚀';

    const createRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        name: groupName,
        description: groupDesc,
        image: groupImg,
        members: [userB._id]
      })
    });
    const createData = await createRes.json();

    assert(createRes.status === 201, 'POST /api/groups returns HTTP 201 Created');
    assert(createData.success === true, 'Response success is true');
    assert(createData.group.name === groupName, 'Group name matches');
    assert(createData.group.description === groupDesc, 'Group description matches');
    assert(createData.group.image === groupImg, 'Group image matches');
    assert(createData.group.createdBy._id === userA._id, 'Creator is Alice');
    assert(createData.group.admins.some((a) => a._id === userA._id), 'Alice is admin');
    assert(createData.group.members.some((m) => m._id === userA._id) && createData.group.members.some((m) => m._id === userB._id), 'Alice and Bob are members');

    const groupId = createData.group._id;

    // Verify MongoDB document fields
    const dbGroup = await mongoose.connection.collection('groups').findOne({ _id: new mongoose.Types.ObjectId(groupId) });
    assert(dbGroup !== null, 'Group document found in MongoDB collection "groups"');
    assert(dbGroup.name === groupName && dbGroup.image === groupImg, 'Group document contains all schema fields');

    // --- TEST 2: GET /api/groups & GET /api/groups/:id ---
    console.log('\n[Test 2] Testing GET /api/groups & GET /api/groups/:id...');
    // Alice's groups
    const aliceGrpsRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const aliceGrps = await aliceGrpsRes.json();
    assert(aliceGrps.groups.some((g) => g._id === groupId), 'Alice lists the new group');

    // Bob's groups
    const bobGrpsRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const bobGrps = await bobGrpsRes.json();
    assert(bobGrps.groups.some((g) => g._id === groupId), 'Bob lists the new group');

    // Charlie (non-member)
    const charlieGrpsRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      headers: { 'Authorization': `Bearer ${tokenC}` }
    });
    const charlieGrps = await charlieGrpsRes.json();
    assert(!charlieGrps.groups.some((g) => g._id === groupId), 'Non-member Charlie does not list the group');

    // Charlie attempts GET /api/groups/:id
    const charlieGetRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}`, {
      headers: { 'Authorization': `Bearer ${tokenC}` }
    });
    assert(charlieGetRes.status === 403, 'Non-member access rejected with HTTP 403 Forbidden');

    // --- TEST 3: PUT /api/groups/:id (Admin Update Group) ---
    console.log('\n[Test 3] Testing PUT /api/groups/:id (Admin Only)...');
    // Bob (not admin) tries to edit
    const bobEditRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({ name: 'Hacked Name' })
    });
    assert(bobEditRes.status === 403, 'Non-admin edit rejected with HTTP 403');

    // Alice (admin) edits group
    const updatedGroupName = 'Tech Leaders 2026';
    const aliceEditRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ name: updatedGroupName })
    });
    const aliceEditData = await aliceEditRes.json();
    assert(aliceEditRes.status === 200, 'Admin edit returns HTTP 200');
    assert(aliceEditData.group.name === updatedGroupName, 'Group name successfully updated');

    // --- TEST 4: POST /api/groups/:id/members (Add Members) ---
    console.log('\n[Test 4] Testing POST /api/groups/:id/members (Add Member)...');
    // Bob (non-admin) tries to add Charlie
    const bobAddRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({ userId: userC._id })
    });
    assert(bobAddRes.status === 403, 'Non-admin member addition rejected with HTTP 403');

    // Alice (admin) adds Charlie
    const aliceAddRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ userId: userC._id })
    });
    const aliceAddData = await aliceAddRes.json();
    assert(aliceAddRes.status === 200, 'Admin member addition returns HTTP 200');
    assert(aliceAddData.group.members.some((m) => m._id === userC._id), 'Charlie is now a member of the group');

    // Duplicate add rejection
    const dupAddRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ userId: userC._id })
    });
    assert(dupAddRes.status === 400, 'Duplicate member addition rejected with HTTP 400');

    // --- TEST 5: Real-Time Multi-User Socket Group Chat (Alice, Bob, Charlie) ---
    console.log('\n[Test 5] Testing Real-Time Group Chat with 3 Connected Users...');

    socketAlice = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenA },
      transports: ['websocket'],
      forceNew: true
    });
    socketBob = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenB },
      transports: ['websocket'],
      forceNew: true
    });
    socketCharlie = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenC },
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise((res) => socketAlice.on('connect', res)),
      new Promise((res) => socketBob.on('connect', res)),
      new Promise((res) => socketCharlie.on('connect', res))
    ]);

    assert(socketAlice.connected && socketBob.connected && socketCharlie.connected, 'All 3 sockets connected');

    // Join room explicitly
    socketAlice.emit('join-group', { groupId });
    socketBob.emit('join-group', { groupId });
    socketCharlie.emit('join-group', { groupId });
    await sleep(300);

    // Group Typing Indicator
    let bobReceivedTyping = false;
    let charlieReceivedTyping = false;

    socketBob.on('group-typing', (data) => {
      if (data.groupId === groupId && data.sender === userA._id) bobReceivedTyping = true;
    });
    socketCharlie.on('group-typing', (data) => {
      if (data.groupId === groupId && data.sender === userA._id) charlieReceivedTyping = true;
    });

    socketAlice.emit('group-typing', { groupId });
    await sleep(400);

    assert(bobReceivedTyping && charlieReceivedTyping, 'Bob and Charlie both received Alice group typing indicator');

    socketAlice.emit('group-stop-typing', { groupId });
    await sleep(200);

    // Send Group Message
    const groupMsgText = 'Welcome team to the Tech Leaders group!';
    let bobReceivedMessage = null;
    let charlieReceivedMessage = null;

    const bobMsgPromise = new Promise((resolve) => {
      socketBob.on('group-message', (msg) => {
        bobReceivedMessage = msg;
        resolve();
      });
    });

    const charlieMsgPromise = new Promise((resolve) => {
      socketCharlie.on('group-message', (msg) => {
        charlieReceivedMessage = msg;
        resolve();
      });
    });

    socketAlice.emit('group-message', {
      groupId,
      text: groupMsgText
    });

    await Promise.all([bobMsgPromise, charlieMsgPromise]);

    assert(bobReceivedMessage !== null && bobReceivedMessage.text === groupMsgText, 'Bob received group message in real time');
    assert(charlieReceivedMessage !== null && charlieReceivedMessage.text === groupMsgText, 'Charlie received group message in real time');
    assert(bobReceivedMessage.sender.username === aliceData.username, 'Message populated with sender username');

    // Verify Group Message persisted in MongoDB
    const dbGrpMsg = await mongoose.connection.collection('messages').findOne({ text: groupMsgText });
    assert(dbGrpMsg !== null, 'Group message document persisted in MongoDB');
    assert(dbGrpMsg.groupId.toString() === groupId, 'Message document contains correct groupId');
    assert(dbGrpMsg.sender.toString() === userA._id, 'Message document contains correct sender');

    // Fetch Group Message History via REST API
    const historyRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/messages`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const historyData = await historyRes.json();
    assert(historyRes.status === 200, 'GET /api/groups/:id/messages returns HTTP 200');
    assert(historyData.count >= 1 && historyData.messages[0].text === groupMsgText, 'Chat history contains sent group message');

    // --- TEST 6: Remove Member & Leave Group ---
    console.log('\n[Test 6] Testing Remove Member & Leave Group...');
    // Charlie (non-admin) tries to remove Bob
    const charlieRemoveBob = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members/${userB._id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenC}` }
    });
    assert(charlieRemoveBob.status === 403, 'Non-admin removing another member rejected with HTTP 403');

    // Alice (admin) removes Bob
    const aliceRemoveBob = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members/${userB._id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(aliceRemoveBob.status === 200, 'Admin removing member returns HTTP 200');

    // Charlie leaves group voluntarily
    const charlieLeave = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members/${userC._id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenC}` }
    });
    const charlieLeaveData = await charlieLeave.json();
    assert(charlieLeave.status === 200, 'Member leaving group returns HTTP 200');
    assert(!charlieLeaveData.group.members.some((m) => m._id === userC._id), 'Charlie is no longer in group members');

    // --- TEST 7: Preserve One-to-One Chat ---
    console.log('\n[Test 7] Verifying One-to-One Chat Remains Fully Functional...');
    const directText = 'Direct 1-on-1 message between Alice and Bob';
    let bobReceivedDirect = false;

    socketBob.on('receive-message', (msg) => {
      if (msg.text === directText) bobReceivedDirect = true;
    });

    socketAlice.emit('send-message', {
      receiver: userB._id,
      text: directText
    });

    await sleep(600);
    assert(bobReceivedDirect, 'One-to-one direct messaging works simultaneously without conflict');

    // Cleanup test data
    await mongoose.connection.collection('users').deleteMany({
      $or: [
        { email: aliceData.email },
        { email: bobData.email },
        { email: charlieData.email }
      ]
    });
    await mongoose.connection.collection('groups').deleteOne({ _id: new mongoose.Types.ObjectId(groupId) });
    await mongoose.connection.collection('messages').deleteMany({
      $or: [
        { groupId: new mongoose.Types.ObjectId(groupId) },
        { text: directText }
      ]
    });
    console.log('[Cleanup] Test users, groups, and messages removed from MongoDB.');

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 6 TESTS PASSED SUCCESSFULLY!');
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

runPhase6Tests();
