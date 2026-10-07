const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase4Tests() {
  console.log('====================================================');
  console.log('   STARTING PHASE 4 REAL-TIME 1-ON-1 CHAT TESTS');
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

    // Setup 2 test users (Alice and Bob)
    const timestamp = Date.now();
    const aliceData = {
      username: `alice_chat_${timestamp}`,
      email: `alice_chat_${timestamp}@example.com`,
      password: 'Password123!',
      bio: 'Alice in Chatland'
    };
    const bobData = {
      username: `bob_chat_${timestamp}`,
      email: `bob_chat_${timestamp}@example.com`,
      password: 'Password123!',
      bio: 'Bob the Builder'
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

    // --- TEST 1: Two Separate Authenticated Socket Sessions ---
    console.log('\n[Test 1] Establishing Two Authenticated Socket Connections...');

    socketAlice = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenA },
      transports: ['websocket']
    });

    await new Promise((resolve) => socketAlice.on('connect', resolve));
    assert(socketAlice.connected, `Alice connected to Socket.IO with ID: ${socketAlice.id}`);

    // Track user-online event received by Alice when Bob connects
    let aliceReceivedBobOnline = false;
    socketAlice.on('user-online', (data) => {
      if (data.userId === userB._id) {
        aliceReceivedBobOnline = true;
      }
    });

    socketBob = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: tokenB },
      transports: ['websocket']
    });

    await new Promise((resolve) => socketBob.on('connect', resolve));
    assert(socketBob.connected, `Bob connected to Socket.IO with ID: ${socketBob.id}`);

    await sleep(500);
    assert(aliceReceivedBobOnline, 'Alice received real-time "user-online" event when Bob connected');

    // --- TEST 2: Real-time Typing Indicators ---
    console.log('\n[Test 2] Testing Typing & Stop-Typing Indicators...');

    const typingPromise = new Promise((resolve) => {
      socketBob.on('typing', (data) => {
        assert(data.sender === userA._id, 'Bob received "typing" event from Alice');
        resolve();
      });
    });

    socketAlice.emit('typing', { receiver: userB._id });
    await typingPromise;

    const stopTypingPromise = new Promise((resolve) => {
      socketBob.on('stop-typing', (data) => {
        assert(data.sender === userA._id, 'Bob received "stop-typing" event from Alice');
        resolve();
      });
    });

    socketAlice.emit('stop-typing', { receiver: userB._id });
    await stopTypingPromise;

    // --- TEST 3: Send & Instant Receive Message ---
    console.log('\n[Test 3] Testing Real-Time send-message & receive-message...');

    const testText = 'Hello Bob! This is Alice sending a real-time message.';
    let aliceReceivedEcho = false;
    let bobReceivedMessage = null;

    const bobReceivePromise = new Promise((resolve) => {
      socketBob.on('receive-message', (msg) => {
        bobReceivedMessage = msg;
        resolve();
      });
    });

    const aliceEchoPromise = new Promise((resolve) => {
      socketAlice.on('receive-message', (msg) => {
        if (msg.text === testText) {
          aliceReceivedEcho = true;
          resolve();
        }
      });
    });

    socketAlice.emit('send-message', {
      receiver: userB._id,
      text: testText
    });

    await Promise.all([bobReceivePromise, aliceEchoPromise]);

    assert(aliceReceivedEcho, 'Sender (Alice) received instant message acknowledgment');
    assert(bobReceivedMessage !== null, 'Recipient (Bob) received message instantly');
    assert(bobReceivedMessage.text === testText, 'Message text matches expected payload');
    assert(bobReceivedMessage.sender._id === userA._id, 'Message sender populated correctly');
    assert(bobReceivedMessage.receiver._id === userB._id, 'Message receiver populated correctly');
    assert(bobReceivedMessage.status === 'sent', 'Initial message status is "sent"');
    assert(bobReceivedMessage.createdAt !== undefined, 'Message timestamp createdAt present');

    // --- TEST 4: MongoDB Message Persistence & Schema Verification ---
    console.log('\n[Test 4] Verifying Message Persistence in MongoDB...');
    const savedMsgInDb = await mongoose.connection.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(bobReceivedMessage._id) });
    assert(savedMsgInDb !== null, 'Message document persisted in MongoDB collection "messages"');
    assert(savedMsgInDb.text === testText, 'Database message text matches');
    assert(savedMsgInDb.sender.toString() === userA._id, 'Database sender ObjectId matches');
    assert(savedMsgInDb.receiver.toString() === userB._id, 'Database receiver ObjectId matches');
    assert(savedMsgInDb.messageType === 'text', 'Database messageType is "text"');
    assert(savedMsgInDb.status === 'sent', 'Database status is "sent"');

    // --- TEST 5: Offline Message Storage ---
    console.log('\n[Test 5] Testing Offline Messaging Storage...');
    let aliceReceivedBobOffline = false;
    socketAlice.on('user-offline', (data) => {
      if (data.userId === userB._id) {
        aliceReceivedBobOffline = true;
      }
    });

    // Bob goes offline
    socketBob.disconnect();
    await sleep(600);
    assert(aliceReceivedBobOffline, 'Alice received "user-offline" event after Bob disconnected');

    // Alice sends message while Bob is offline
    const offlineText = 'Bob, you are offline right now, but this must be stored in DB!';
    const offlineSendAck = await new Promise((resolve) => {
      socketAlice.emit('send-message', {
        receiver: userB._id,
        text: offlineText
      }, (ack) => {
        resolve(ack);
      });
    });

    assert(offlineSendAck.success === true, 'Server acknowledged saving offline message');

    const offlineMsgInDb = await mongoose.connection.collection('messages').findOne({ text: offlineText });
    assert(offlineMsgInDb !== null, 'Offline message safely stored in MongoDB');
    assert(offlineMsgInDb.receiver.toString() === userB._id, 'Offline message target is Bob');

    // --- TEST 6: Chat History APIs ---
    console.log('\n[Test 6] Testing GET /api/messages/:userId (History Retrieval)...');
    const historyResAlice = await fetch(`http://localhost:${config.port}/api/messages/${userB._id}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const historyDataAlice = await historyResAlice.json();

    assert(historyResAlice.status === 200, 'GET /api/messages/:userId returns HTTP 200');
    assert(historyDataAlice.success === true, 'Response contains success: true');
    assert(historyDataAlice.count === 2, 'History contains both sent messages (2 messages)');
    assert(historyDataAlice.messages[0].text === testText, 'First message matches chronological order');
    assert(historyDataAlice.messages[1].text === offlineText, 'Second (offline) message retrieved');

    // Bob fetches history when returning
    const historyResBob = await fetch(`http://localhost:${config.port}/api/messages/${userA._id}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const historyDataBob = await historyResBob.json();
    assert(historyResBob.status === 200, 'Bob fetches chat history with Alice');
    assert(historyDataBob.count === 2, 'Bob retrieved all messages including the offline message');

    // --- TEST 7: Chat History API between two users ---
    console.log('\n[Test 7] Testing GET /api/messages/:userId/:otherUserId...');
    const betweenUsersRes = await fetch(`http://localhost:${config.port}/api/messages/${userA._id}/${userB._id}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const betweenUsersData = await betweenUsersRes.json();
    assert(betweenUsersRes.status === 200, 'GET /api/messages/:userId/:otherUserId returns HTTP 200');
    assert(betweenUsersData.count === 2, 'Returns exact conversation between both participants');

    // Unauthorized non-participant check
    const eveData = {
      username: `eve_chat_${timestamp}`,
      email: `eve_chat_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const regEve = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eveData)
      })
    ).json();

    const eveAccessRes = await fetch(`http://localhost:${config.port}/api/messages/${userA._id}/${userB._id}`, {
      headers: { 'Authorization': `Bearer ${regEve.token}` }
    });
    assert(eveAccessRes.status === 403, 'Non-participant eavesdropper rejected with HTTP 403 Forbidden');

    // Cleanup test data
    await mongoose.connection.collection('users').deleteMany({
      $or: [
        { email: aliceData.email },
        { email: bobData.email },
        { email: eveData.email }
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
      console.log('🎉 ALL PHASE 4 TESTS PASSED SUCCESSFULLY!');
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

runPhase4Tests();
