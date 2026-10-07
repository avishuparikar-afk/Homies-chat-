const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');
const { createRateLimiter } = require('../server/middlewares/security.middleware');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase12Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 12 SECURITY & PERFORMANCE AUDIT TESTS');
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
    // SECTION 1: AUTHENTICATION, JWT HANDLING & PASSWORD HASHING
    // =========================================================================
    console.log('\n--- Section 1: Authentication, JWT & Password Hashing ---');

    const timestamp = Date.now();
    const aliceData = {
      username: `sec_alice_${timestamp}`,
      email: `sec_alice_${timestamp}@security.org`,
      password: 'StrongAlicePass#2026',
      bio: 'Alice Security Researcher'
    };
    const bobData = {
      username: `sec_bob_${timestamp}`,
      email: `sec_bob_${timestamp}@security.org`,
      password: 'StrongBobPass#2026',
      bio: 'Bob Defensive Analyst'
    };
    const charlieData = {
      username: `sec_charlie_${timestamp}`,
      email: `sec_charlie_${timestamp}@security.org`,
      password: 'StrongCharliePass#2026',
      bio: 'Charlie Penetration Tester'
    };

    // Register Users
    const regAlice = await (await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aliceData)
    })).json();
    assert(regAlice.success === true, 'Alice registered successfully');
    const aliceId = regAlice.user._id;
    const aliceToken = regAlice.token;

    const regBob = await (await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bobData)
    })).json();
    assert(regBob.success === true, 'Bob registered successfully');
    const bobId = regBob.user._id;
    const bobToken = regBob.token;

    const regCharlie = await (await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charlieData)
    })).json();
    assert(regCharlie.success === true, 'Charlie registered successfully');
    const charlieId = regCharlie.user._id;
    const charlieToken = regCharlie.token;

    // Password Hashing Verification in MongoDB
    const aliceDbUser = await mongoose.connection.collection('users').findOne({ _id: new mongoose.Types.ObjectId(aliceId) });
    assert(
      aliceDbUser && aliceDbUser.password && (aliceDbUser.password.startsWith('$2a$') || aliceDbUser.password.startsWith('$2b$')),
      'Password in MongoDB is cryptographically hashed with bcrypt'
    );
    assert(!aliceDbUser.password.includes('StrongAlicePass#2026'), 'Plaintext password is NEVER stored in database');

    // JWT Handling: Missing Token
    const noTokenRes = await fetch(`http://localhost:${config.port}/api/auth/me`);
    assert(noTokenRes.status === 401, 'Request without JWT rejected with HTTP 401 Unauthorized');

    // JWT Handling: Tampered Token
    const tamperedTokenRes = await fetch(`http://localhost:${config.port}/api/auth/me`, {
      headers: { Authorization: `Bearer ${aliceToken.slice(0, -6)}tamper` }
    });
    assert(tamperedTokenRes.status === 401, 'Request with tampered JWT rejected with HTTP 401 Unauthorized');

    // JWT Handling: Valid Token
    const validTokenRes = await fetch(`http://localhost:${config.port}/api/auth/me`, {
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    const validTokenJson = await validTokenRes.json();
    assert(validTokenRes.status === 200 && validTokenJson.user._id === aliceId, 'Valid JWT successfully authenticated');
    assert(validTokenJson.user.password === undefined, 'Password field is never exposed in user API response');

    // =========================================================================
    // SECTION 2: HTTP SECURITY HEADERS & NOSQL INJECTION PROTECTION
    // =========================================================================
    console.log('\n--- Section 2: Security Headers & NoSQL Injection Protection ---');

    // Check Security Headers
    assert(validTokenRes.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff header present');
    assert(validTokenRes.headers.get('x-frame-options') === 'SAMEORIGIN', 'X-Frame-Options: SAMEORIGIN header present');
    assert(validTokenRes.headers.get('x-xss-protection') === '1; mode=block', 'X-XSS-Protection header present');

    // NoSQL Injection Test: Operator injection in login request
    const nosqlPayload = {
      email: { $gt: '' },
      password: { $gt: '' }
    };
    const nosqlLoginRes = await fetch(`http://localhost:${config.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nosqlPayload)
    });
    // NoSQL injection query sanitizer must strip $gt, leaving empty or invalid body rejected
    assert(
      nosqlLoginRes.status === 400 || nosqlLoginRes.status === 401,
      'NoSQL operator injection ($gt) neutralized and rejected with HTTP 400/401'
    );

    // =========================================================================
    // SECTION 3: RATE LIMITING AUDIT
    // =========================================================================
    console.log('\n--- Section 3: Rate Limiting Audit ---');

    // Verify rate limit headers
    assert(validTokenRes.headers.has('x-ratelimit-limit'), 'X-RateLimit-Limit header present on API responses');
    assert(validTokenRes.headers.has('x-ratelimit-remaining'), 'X-RateLimit-Remaining header present on API responses');

    // Test a mini rate-limiter instance to verify 429 and Retry-After
    const testLimiter = createRateLimiter({ windowMs: 2000, max: 2, message: 'Rate limit test reached' });
    let blockedCount = 0;
    const mockReq = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
    const mockRes = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) {
        this.statusCode = code;
        return {
          json: (data) => {
            if (code === 429) blockedCount++;
          }
        };
      }
    };
    const nextFn = () => {};

    testLimiter(mockReq, mockRes, nextFn); // 1st
    testLimiter(mockReq, mockRes, nextFn); // 2nd
    testLimiter(mockReq, mockRes, nextFn); // 3rd -> blocked 429
    assert(blockedCount === 1, 'Rate limiter strictly returns HTTP 429 after exceeding max hits');
    assert(Boolean(mockRes.headers['Retry-After']), 'HTTP 429 response includes Retry-After header');

    // =========================================================================
    // SECTION 4: FILE UPLOAD SECURITY & PRIVATE ACCESS AUTHORIZATION
    // =========================================================================
    console.log('\n--- Section 4: File Upload Security & Private Access Authorization ---');

    // Dangerous file extension rejection: try to upload an executable
    const fakeExeFormData = new FormData();
    const fakeExeBlob = new Blob(['MZ\x90\x00\x03\x00\x00\x00'], { type: 'application/octet-stream' });
    fakeExeFormData.append('file', fakeExeBlob, 'malware.exe');

    const exeUploadRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: fakeExeFormData
    });
    const exeUploadJson = await exeUploadRes.json();
    assert(
      exeUploadRes.status === 400 && exeUploadJson.message.toLowerCase().includes('dangerous'),
      'Dangerous executable (.exe) upload rejected with HTTP 400'
    );

    // Valid upload: Alice uploads a private confidential text document to Bob
    const validDocFormData = new FormData();
    const docBlob = new Blob(['Confidential Q4 Financial Assessment between Alice and Bob.'], { type: 'text/plain' });
    validDocFormData.append('file', docBlob, 'confidential_report.txt');
    validDocFormData.append('conversationType', 'direct');
    validDocFormData.append('recipientId', bobId);

    const docUploadRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: validDocFormData
    });
    const docUploadJson = await docUploadRes.json();
    assert(docUploadRes.status === 201 && docUploadJson.success === true, 'Confidential file uploaded successfully by Alice');
    const uploadedFileName = docUploadJson.file.fileName;

    // Authorized Access: Alice (uploader) can view file
    const aliceViewRes = await fetch(`http://localhost:${config.port}/api/files/view/${uploadedFileName}`, {
      headers: { Authorization: `Bearer ${aliceToken}` }
    });
    assert(aliceViewRes.status === 200, 'Alice (uploader) authorized to view file (HTTP 200)');
    assert(aliceViewRes.headers.get('content-security-policy') === "default-src 'none'", 'File view endpoint sets Content-Security-Policy: default-src none');

    // Authorized Access: Bob (recipient) can view file
    const bobViewRes = await fetch(`http://localhost:${config.port}/api/files/view/${uploadedFileName}`, {
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    assert(bobViewRes.status === 200, 'Bob (recipient) authorized to view file (HTTP 200)');

    // UNAUTHORIZED Access Attempt: Charlie (unrelated third party) tries to view or download Alice & Bob private file
    const charlieViewRes = await fetch(`http://localhost:${config.port}/api/files/view/${uploadedFileName}`, {
      headers: { Authorization: `Bearer ${charlieToken}` }
    });
    assert(charlieViewRes.status === 403, 'Charlie unauthorized attempt to view private file BLOCKED with HTTP 403 Forbidden');

    const charlieDownloadRes = await fetch(`http://localhost:${config.port}/api/files/download/${uploadedFileName}`, {
      headers: { Authorization: `Bearer ${charlieToken}` }
    });
    assert(charlieDownloadRes.status === 403, 'Charlie unauthorized attempt to download private file BLOCKED with HTTP 403 Forbidden');

    // Unauthenticated attempt to view file
    const anonViewRes = await fetch(`http://localhost:${config.port}/api/files/view/${uploadedFileName}`);
    assert(anonViewRes.status === 401, 'Unauthenticated file view request rejected with HTTP 401');

    // =========================================================================
    // SECTION 5: GROUP PERMISSIONS & AUTHORIZATION AUDIT
    // =========================================================================
    console.log('\n--- Section 5: Group Permissions & Authorization Audit ---');

    // Alice creates group with Bob
    const grpRes = await (await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: 'Core Security Council',
        description: 'Authorized personnel only',
        members: [bobId]
      })
    })).json();
    const groupId = grpRes.group._id;

    // Bob (non-admin) tries to update group info: must be rejected with 403
    const bobEditGrpRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`
      },
      body: JSON.stringify({ name: 'Hacked Council Name' })
    });
    assert(bobEditGrpRes.status === 403, 'Non-admin member (Bob) cannot edit group details (HTTP 403)');

    // Bob (non-admin) tries to add Charlie: must be rejected with 403
    const bobAddMemberRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`
      },
      body: JSON.stringify({ userId: charlieId })
    });
    assert(bobAddMemberRes.status === 403, 'Non-admin member (Bob) cannot add members (HTTP 403)');

    // Charlie (non-member) tries to read group message history: must be rejected with 403
    const charlieGrpMsgRes = await fetch(`http://localhost:${config.port}/api/groups/${groupId}/messages`, {
      headers: { Authorization: `Bearer ${charlieToken}` }
    });
    assert(charlieGrpMsgRes.status === 403, 'Non-member (Charlie) cannot read group messages (HTTP 403)');

    // =========================================================================
    // SECTION 6: UNAUTHORIZED MESSAGE DELETION AUDIT
    // =========================================================================
    console.log('\n--- Section 6: Message Deletion Authorization Audit ---');

    // Alice creates direct message for Bob
    const msgDoc = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceId),
      receiver: new mongoose.Types.ObjectId(bobId),
      groupId: null,
      text: 'Alice private statement that only she can delete for everyone',
      messageType: 'text',
      status: 'delivered',
      deletedFor: [],
      isDeletedForEveryone: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const msgId = msgDoc.insertedId.toString();

    // Bob tries to delete Alice's message FOR EVERYONE: must be rejected with 403
    const bobDelForEveryoneRes = await fetch(
      `http://localhost:${config.port}/api/messages/${msgId}?type=everyone`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bobToken}` }
      }
    );
    assert(bobDelForEveryoneRes.status === 403, 'Receiver (Bob) cannot delete sender (Alice) message for everyone (HTTP 403)');

    // Charlie (outsider) tries to delete Alice's message: must be rejected with 403
    const charlieDelRes = await fetch(
      `http://localhost:${config.port}/api/messages/${msgId}?type=me`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${charlieToken}` }
      }
    );
    assert(charlieDelRes.status === 403, 'Non-participant (Charlie) cannot delete conversation message (HTTP 403)');

    // Alice deletes her own message for everyone: succeeds with 200
    const aliceDelRes = await fetch(
      `http://localhost:${config.port}/api/messages/${msgId}?type=everyone`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` }
      }
    );
    assert(aliceDelRes.status === 200, 'Sender (Alice) authorized to delete message for everyone (HTTP 200)');

    // =========================================================================
    // SECTION 7: SOCKET EVENT AUTHORIZATION & PERFORMANCE
    // =========================================================================
    console.log('\n--- Section 7: Socket Event Authorization & Performance ---');

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
    socketCharlie = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: charlieToken },
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise((res) => socketAlice.on('connect', res)),
      new Promise((res) => socketBob.on('connect', res)),
      new Promise((res) => socketCharlie.on('connect', res))
    ]);
    assert(socketAlice.connected && socketBob.connected && socketCharlie.connected, 'Sockets connected with JWT authentication');

    // Bob & Alice join group room
    socketAlice.emit('join-group', { groupId });
    socketBob.emit('join-group', { groupId });
    await sleep(300);

    // Charlie (non-member) tries to spoof group-typing into Alice & Bob's private group
    let bobReceivedSpoofedTyping = false;
    socketBob.on('group-typing', (data) => {
      if (data.sender === charlieId) {
        bobReceivedSpoofedTyping = true;
      }
    });

    socketCharlie.emit('group-typing', { groupId });
    await sleep(400);
    assert(!bobReceivedSpoofedTyping, 'Unauthorized group-typing event from non-member Charlie successfully rejected by server');

    // =========================================================================
    // SECTION 8: DATABASE INDEXES & QUERY PERFORMANCE AUDIT
    // =========================================================================
    console.log('\n--- Section 8: Database Indexes & Query Performance Audit ---');

    const userIndexes = await mongoose.connection.collection('users').indexes();
    const userIndexNames = userIndexes.map((idx) => Object.keys(idx.key).join('_'));
    assert(userIndexNames.some((name) => name.includes('username')), 'Users collection has username unique index');
    assert(userIndexNames.some((name) => name.includes('online')), 'Users collection has online presence sorting index');

    const msgIndexes = await mongoose.connection.collection('messages').indexes();
    const msgIndexNames = msgIndexes.map((idx) => Object.keys(idx.key).join('_'));
    assert(msgIndexNames.some((name) => name.includes('sender') && name.includes('receiver')), 'Messages collection has compound sender/receiver chat history index');
    assert(msgIndexNames.some((name) => name.includes('groupId')), 'Messages collection has groupId index');
    assert(msgIndexNames.some((name) => name.includes('fileName')), 'Messages collection has fileName index for file lookups');
    assert(msgIndexNames.some((name) => name.includes('deletedFor')), 'Messages collection has deletedFor index');

    const grpIndexes = await mongoose.connection.collection('groups').indexes();
    const grpIndexNames = grpIndexes.map((idx) => Object.keys(idx.key).join('_'));
    assert(grpIndexNames.some((name) => name.includes('members')), 'Groups collection has members membership index');

    const notifIndexes = await mongoose.connection.collection('notifications').indexes();
    const notifIndexNames = notifIndexes.map((idx) => Object.keys(idx.key).join('_'));
    assert(notifIndexNames.some((name) => name.includes('user') && name.includes('read')), 'Notifications collection has user unread compound index');

    // Verify Pagination on direct message history API
    const paginatedHistoryRes = await fetch(
      `http://localhost:${config.port}/api/messages/${bobId}?limit=1&page=1`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const paginatedHistoryJson = await paginatedHistoryRes.json();
    assert(paginatedHistoryRes.status === 200, 'GET /api/messages/:id with pagination returns HTTP 200');
    assert(paginatedHistoryJson.count <= 1, 'Pagination limit parameter respected (count <= 1)');

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
    console.log('🎉 ALL PHASE 12 SECURITY & PERFORMANCE AUDIT TESTS PASSED! (0 failures)');
    process.exit(0);
  } else {
    console.error(`💥 PHASE 12 AUDIT COMPLETED WITH ${testFailures} FAILURE(S)`);
    process.exit(1);
  }
}

runPhase12Tests();
