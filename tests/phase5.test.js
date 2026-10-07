const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase5Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 5 DELIVERY STATES (SENT/DELIV/READ)');
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

    // Connect mongoose for verification and cleanup
    await mongoose.connect(config.mongoUri);

    // Register Alice and Bob
    const timestamp = Date.now();
    const aliceData = {
      username: `alice_p5_${timestamp}`,
      email: `alice_p5_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const bobData = {
      username: `bob_p5_${timestamp}`,
      email: `bob_p5_${timestamp}@example.com`,
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

    assert(tokenA && tokenB, 'Alice and Bob registered successfully');

    // Connect both sockets
    socketAlice = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenA },
      transports: ['websocket']
    });
    await new Promise((resolve) => socketAlice.on('connect', resolve));

    socketBob = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenB },
      transports: ['websocket']
    });
    await new Promise((resolve) => socketBob.on('connect', resolve));

    assert(socketAlice.connected && socketBob.connected, 'Alice and Bob connected via Socket.IO');

    // --- TEST 1: Both Online -> Message Sent & Delivered ---
    console.log('\n[Test 1] Testing Message Sent & Delivered (Both Online)...');
    const msgText1 = 'Hey Bob, checking delivery state!';
    let sentEventReceived = false;
    let deliveredEventReceived = false;
    let statusUpdatedToDelivered = false;
    let messageId1 = null;

    socketAlice.on('message-sent', (data) => {
      if (data.message && data.message.text === msgText1) {
        sentEventReceived = true;
        messageId1 = data.messageId;
      }
    });

    socketAlice.on('message-delivered', (data) => {
      deliveredEventReceived = true;
    });

    socketAlice.on('message-status-updated', (data) => {
      if (data.status === 'delivered') {
        statusUpdatedToDelivered = true;
      }
    });

    // Bob receives message and acknowledges delivery
    socketBob.on('receive-message', (msg) => {
      if (msg.text === msgText1) {
        socketBob.emit('message-delivered', {
          messageId: msg._id,
          senderId: userA._id
        });
      }
    });

    socketAlice.emit('send-message', {
      receiver: userB._id,
      text: msgText1
    });

    // Wait for delivery roundtrip
    for (let i = 0; i < 20; i++) {
      if (sentEventReceived && deliveredEventReceived && statusUpdatedToDelivered) break;
      await sleep(200);
    }

    assert(sentEventReceived, 'Alice received "message-sent" event with initial SENT state');
    assert(deliveredEventReceived, 'Alice received "message-delivered" event once Bob received the message');
    assert(statusUpdatedToDelivered, 'Alice received "message-status-updated" (DELIVERED) event');

    // Verify status in MongoDB is 'delivered'
    const dbMsg1 = await mongoose.connection.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(messageId1) });
    assert(dbMsg1 !== null && dbMsg1.status === 'delivered', 'Message status in MongoDB is "delivered"');

    // --- TEST 2: Receiver Offline -> Message Remains SENT ---
    console.log('\n[Test 2] Testing Receiver Offline (Remains SENT)...');
    socketBob.disconnect();
    await sleep(500);

    const msgText2 = 'Bob is offline, this should remain SENT!';
    let sentEvent2Received = false;
    let deliveredEvent2Received = false;
    let messageId2 = null;

    socketAlice.on('message-sent', (data) => {
      if (data.message && data.message.text === msgText2) {
        sentEvent2Received = true;
        messageId2 = data.messageId;
      }
    });

    socketAlice.on('message-delivered', (data) => {
      if (data.messageId === messageId2) {
        deliveredEvent2Received = true;
      }
    });

    socketAlice.emit('send-message', {
      receiver: userB._id,
      text: msgText2
    });

    await sleep(1000);

    assert(sentEvent2Received, 'Alice received "message-sent" for offline message');
    assert(!deliveredEvent2Received, 'No "message-delivered" event fired while Bob is offline');

    const dbMsg2 = await mongoose.connection.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(messageId2) });
    assert(dbMsg2 !== null && dbMsg2.status === 'sent', 'Message status in MongoDB remains "sent" while recipient is offline');

    // --- TEST 3: Receiver Reconnects & Acknowledges Delivery ---
    console.log('\n[Test 3] Testing Receiver Reconnects & Delivery Transition...');
    socketBob = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenB },
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise((resolve) => socketBob.on('connect', resolve));
    assert(socketBob.connected, 'Bob reconnected to Socket.IO');

    let offlineMsgDelivered = false;
    socketAlice.on('message-delivered', (data) => {
      if (data.messageId === messageId2 || data.receiverId === userB._id) {
        offlineMsgDelivered = true;
      }
    });

    await sleep(200);

    // Bob acknowledges delivery of offline message
    socketBob.emit('message-delivered', {
      messageId: messageId2,
      senderId: userA._id
    });

    for (let i = 0; i < 20; i++) {
      if (offlineMsgDelivered) break;
      await sleep(200);
    }

    assert(offlineMsgDelivered, 'Alice received "message-delivered" after Bob reconnected');
    const dbMsg2Updated = await mongoose.connection.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(messageId2) });
    assert(dbMsg2Updated.status === 'delivered', 'Message status in MongoDB updated to "delivered"');

    // --- TEST 4: Receiver Opens Conversation -> Message Becomes READ ---
    console.log('\n[Test 4] Testing Receiver Opens Conversation (Becomes READ)...');
    let readEventReceived = false;
    let statusUpdatedToRead = false;

    socketAlice.on('message-read', (data) => {
      if (data.readerId === userB._id) {
        readEventReceived = true;
      }
    });

    socketAlice.on('message-status-updated', (data) => {
      if (data.status === 'read') {
        statusUpdatedToRead = true;
      }
    });

    // Bob opens conversation with Alice
    socketBob.emit('message-read', {
      senderId: userA._id
    });

    for (let i = 0; i < 20; i++) {
      if (readEventReceived && statusUpdatedToRead) break;
      await sleep(200);
    }

    assert(readEventReceived, 'Alice received "message-read" event when Bob opened conversation');
    assert(statusUpdatedToRead, 'Alice received "message-status-updated" (READ) event');

    // Verify all messages in MongoDB now marked 'read'
    const unreadCount = await mongoose.connection.collection('messages').countDocuments({
      sender: new mongoose.Types.ObjectId(userA._id),
      receiver: new mongoose.Types.ObjectId(userB._id),
      status: { $ne: 'read' }
    });
    assert(unreadCount === 0, 'All messages from Alice to Bob in MongoDB have status: "read"');

    // --- TEST 5: REST API PUT /api/messages/read/:senderId ---
    console.log('\n[Test 5] Testing REST API PUT /api/messages/read/:senderId...');
    // Alice sends a new message
    const msg3 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(userA._id),
      receiver: new mongoose.Types.ObjectId(userB._id),
      text: 'REST read test',
      messageType: 'text',
      status: 'sent',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const markReadRes = await fetch(`http://localhost:${config.port}/api/messages/read/${userA._id}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const markReadData = await markReadRes.json();
    assert(markReadRes.status === 200, 'PUT /api/messages/read/:senderId returns HTTP 200');
    assert(markReadData.success === true, 'Response success is true');

    const verifiedMsg3 = await mongoose.connection.collection('messages').findOne({ _id: msg3.insertedId });
    assert(verifiedMsg3.status === 'read', 'Database message status updated to "read" via REST endpoint');

    // Cleanup test data
    await mongoose.connection.collection('users').deleteMany({
      $or: [
        { email: aliceData.email },
        { email: bobData.email }
      ]
    });
    await mongoose.connection.collection('messages').deleteMany({
      $or: [
        { sender: new mongoose.Types.ObjectId(userA._id) },
        { receiver: new mongoose.Types.ObjectId(userA._id) }
      ]
    });
    console.log('[Cleanup] Test users and messages cleaned from MongoDB.');

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 5 TESTS PASSED SUCCESSFULLY!');
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

runPhase5Tests();
