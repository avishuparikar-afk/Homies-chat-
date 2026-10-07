const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase7Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 7 FILE & IMAGE SHARING TESTS');
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
  let socketEve = null;

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

    // Connect mongoose for database checks
    await mongoose.connect(config.mongoUri);

    // 2. Setup 3 test users: Alice (sender), Bob (recipient/member), Eve (unauthorized eavesdropper)
    const timestamp = Date.now();
    const aliceData = {
      username: `alice_f_${timestamp}`,
      email: `alice_f_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const bobData = {
      username: `bob_f_${timestamp}`,
      email: `bob_f_${timestamp}@example.com`,
      password: 'Password123!'
    };
    const eveData = {
      username: `eve_f_${timestamp}`,
      email: `eve_f_${timestamp}@example.com`,
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

    const regEve = await (
      await fetch(`http://localhost:${config.port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eveData)
      })
    ).json();

    const aliceToken = regAlice.token;
    const bobToken = regBob.token;
    const eveToken = regEve.token;
    const aliceUser = regAlice.user;
    const bobUser = regBob.user;
    const eveUser = regEve.user;

    assert(aliceToken && bobToken && eveToken, 'Alice, Bob, and Eve registered successfully');

    // ==========================================
    // TEST 1: Valid File Uploads (Images & Documents)
    // ==========================================
    console.log('\n[Test 1] Testing Valid File Uploads (Image and Document)...');

    // 1A: Upload PNG image
    const imagePayload = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489', 'hex');
    const imgFormData = new FormData();
    imgFormData.append(
      'file',
      new Blob([imagePayload], { type: 'image/png' }),
      'diagram_photo.png'
    );

    const uploadImgRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: imgFormData
    });

    const uploadImgJson = await uploadImgRes.json();
    assert(uploadImgRes.status === 201, 'Image upload returns HTTP 201 Created');
    assert(uploadImgJson.success === true, 'Response contains success: true');
    assert(uploadImgJson.file.originalName === 'diagram_photo.png', 'Original image name preserved');
    assert(uploadImgJson.file.fileType === 'image', 'FileType identified as "image"');
    assert(uploadImgJson.file.mimeType === 'image/png', 'MIME type matches image/png');
    assert(Boolean(uploadImgJson.file.fileName), 'Secure disk filename generated');

    const uploadedImageName = uploadImgJson.file.fileName;

    // 1B: Upload PDF document
    const pdfPayload = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const docFormData = new FormData();
    docFormData.append(
      'file',
      new Blob([pdfPayload], { type: 'application/pdf' }),
      'specifications.pdf'
    );

    const uploadDocRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: docFormData
    });

    const uploadDocJson = await uploadDocRes.json();
    assert(uploadDocRes.status === 201, 'Document upload returns HTTP 201 Created');
    assert(uploadDocJson.file.fileType === 'file', 'FileType identified as "file"');
    assert(uploadDocJson.file.originalName === 'specifications.pdf', 'Original document name preserved');

    const uploadedDocName = uploadDocJson.file.fileName;

    // Verify MongoDB storage
    const fileDocInDb = await mongoose.connection
      .collection('files')
      .findOne({ fileName: uploadedImageName });
    assert(Boolean(fileDocInDb), 'File record persisted in MongoDB "files" collection');
    assert(fileDocInDb.uploader.toString() === aliceUser._id, 'Uploader ObjectId matches Alice');

    // ==========================================
    // TEST 2: Security - Reject Dangerous Executables & Unsupported Extensions
    // ==========================================
    console.log('\n[Test 2] Testing Security Validation (Dangerous Executables)...');

    // Attempt .exe upload
    const exeFormData = new FormData();
    exeFormData.append(
      'file',
      new Blob([Buffer.from('MZ\x90\x00\x03\x00\x00\x00')], { type: 'application/x-msdownload' }),
      'malicious_payload.exe'
    );
    const exeRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: exeFormData
    });
    const exeJson = await exeRes.json();
    assert(exeRes.status === 400, 'Dangerous executable .exe upload rejected with HTTP 400');
    assert(exeJson.success === false, 'Executable upload marked success: false');

    // Attempt .bat upload
    const batFormData = new FormData();
    batFormData.append(
      'file',
      new Blob([Buffer.from('@echo off\ndel C:\\* /q')], { type: 'text/plain' }),
      'script.bat'
    );
    const batRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: batFormData
    });
    assert(batRes.status === 400, 'Dangerous script .bat upload rejected with HTTP 400');

    // Attempt unsupported extension (.xyz)
    const badExtFormData = new FormData();
    badExtFormData.append(
      'file',
      new Blob([Buffer.from('random data')], { type: 'application/octet-stream' }),
      'data.xyz'
    );
    const badExtRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: badExtFormData
    });
    assert(badExtRes.status === 400, 'Unsupported extension .xyz rejected with HTTP 400');

    // ==========================================
    // TEST 3: Security - File Size Limit Enforcement
    // ==========================================
    console.log('\n[Test 3] Testing File Size Limit Enforcement (> 10MB)...');

    // 11 MB oversized file
    const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024, 0x61);
    const overFormData = new FormData();
    overFormData.append(
      'file',
      new Blob([oversizedBuffer], { type: 'application/pdf' }),
      'giant_file.pdf'
    );

    const overRes = await fetch(`http://localhost:${config.port}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: overFormData
    });
    const overJson = await overRes.json();
    assert(overRes.status === 400, 'Oversized file (>10MB) rejected with HTTP 400');
    assert(
      overJson.message.toLowerCase().includes('limit') || overJson.message.toLowerCase().includes('10mb'),
      'Clear size limit error message returned'
    );

    // ==========================================
    // TEST 4: Security - Authorization Verification on Private Files
    // ==========================================
    console.log('\n[Test 4] Testing Authorization Access Checks on Private Files...');

    // 4A: Anonymous access without token
    const anonRes = await fetch(
      `http://localhost:${config.port}/api/files/view/${uploadedImageName}`
    );
    assert(anonRes.status === 401, 'Anonymous request to view private file rejected with HTTP 401');

    // 4B: Unauthorized user Eve (valid token, but neither uploader nor recipient yet)
    const eveRes = await fetch(
      `http://localhost:${config.port}/api/files/view/${uploadedImageName}`,
      {
        headers: { Authorization: `Bearer ${eveToken}` }
      }
    );
    assert(
      eveRes.status === 403,
      'Unauthorized user Eve blocked with HTTP 403 Forbidden'
    );

    // 4C: Authorized uploader Alice (can view and download)
    const aliceViewRes = await fetch(
      `http://localhost:${config.port}/api/files/view/${uploadedImageName}`,
      {
        headers: { Authorization: `Bearer ${aliceToken}` }
      }
    );
    assert(aliceViewRes.status === 200, 'Uploader Alice can view file (HTTP 200)');
    assert(
      aliceViewRes.headers.get('content-type') === 'image/png',
      'Content-Type header matches image/png'
    );

    const aliceDownloadRes = await fetch(
      `http://localhost:${config.port}/api/files/download/${uploadedImageName}?token=${aliceToken}`
    );
    assert(
      aliceDownloadRes.status === 200,
      'Uploader Alice can download file via token query param (HTTP 200)'
    );

    // ==========================================
    // TEST 5: Real-Time One-to-One Chat with File Attachment
    // ==========================================
    console.log('\n[Test 5] Testing Real-Time One-to-One Chat with File Attachment...');

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
    socketEve = ClientIO(`http://localhost:${config.port}`, {
      auth: { token: eveToken },
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise((res) => socketAlice.on('connect', res)),
      new Promise((res) => socketBob.on('connect', res)),
      new Promise((res) => socketEve.on('connect', res))
    ]);
    assert(true, 'Alice, Bob, and Eve connected via Socket.IO');
    await sleep(300);

    // Setup listener for Bob
    const bobReceivePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for Bob to receive message')), 5000);
      socketBob.on('receive-message', (msg) => {
        if (msg.fileName === 'diagram_photo.png') {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });

    // Alice sends image message to Bob
    socketAlice.emit('send-message', {
      receiver: bobUser._id,
      text: 'Look at this diagram architecture',
      messageType: 'image',
      fileUrl: `/api/files/download/${uploadedImageName}`,
      fileName: 'diagram_photo.png',
      fileSize: imagePayload.length,
      fileMimeType: 'image/png'
    });

    const receivedMsgByBob = await bobReceivePromise;
    assert(Boolean(receivedMsgByBob), 'Bob received image message in real time');
    assert(receivedMsgByBob.messageType === 'image', 'Received message has messageType "image"');
    assert(receivedMsgByBob.fileName === 'diagram_photo.png', 'Received message preserves fileName');
    assert(receivedMsgByBob.text === 'Look at this diagram architecture', 'Received message preserves caption text');

    // Verify message persistence in DB
    const dbMsg = await mongoose.connection
      .collection('messages')
      .findOne({ _id: new mongoose.Types.ObjectId(receivedMsgByBob._id) });
    assert(Boolean(dbMsg), 'Image message document persisted in MongoDB');
    assert(dbMsg.fileUrl === `/api/files/download/${uploadedImageName}`, 'Message document stores fileUrl');
    assert(dbMsg.fileMimeType === 'image/png', 'Message document stores fileMimeType');

    // Authorization verification:
    // Bob (the recipient) can now view and download the file
    const bobViewRes = await fetch(
      `http://localhost:${config.port}/api/files/view/${uploadedImageName}`,
      {
        headers: { Authorization: `Bearer ${bobToken}` }
      }
    );
    assert(bobViewRes.status === 200, 'Direct chat recipient Bob is now authorized to view file (HTTP 200)');

    // Eve (unauthorized eavesdropper) must still be denied!
    const eveStillDenied = await fetch(
      `http://localhost:${config.port}/api/files/view/${uploadedImageName}`,
      {
        headers: { Authorization: `Bearer ${eveToken}` }
      }
    );
    assert(
      eveStillDenied.status === 403,
      'CRITICAL: Non-participant Eve is strictly denied access (HTTP 403 Forbidden)'
    );

    // ==========================================
    // TEST 6: Real-Time Group Chat with Document Attachment
    // ==========================================
    console.log('\n[Test 6] Testing Real-Time Group Chat with Document Attachment...');

    // Alice creates group with Bob
    const createGroupRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: `Engineering Squad ${timestamp}`,
        description: 'Testing attachments in groups',
        members: [bobUser._id]
      })
    });
    const createGroupJson = await createGroupRes.json();
    const testGroupId = createGroupJson.group._id;
    assert(createGroupRes.status === 201, 'Group created successfully');

    // Join group rooms
    socketAlice.emit('join-group', { groupId: testGroupId });
    socketBob.emit('join-group', { groupId: testGroupId });
    await sleep(200);

    // Bob listens for group document message
    const bobGroupDocPromise = new Promise((resolve) => {
      socketBob.on('group-message', (msg) => {
        if (msg.fileName === 'specifications.pdf') {
          resolve(msg);
        }
      });
    });

    // Alice sends PDF document to group
    socketAlice.emit('group-message', {
      groupId: testGroupId,
      text: 'Final architectural specification document',
      messageType: 'file',
      fileUrl: `/api/files/download/${uploadedDocName}`,
      fileName: 'specifications.pdf',
      fileSize: pdfPayload.length,
      fileMimeType: 'application/pdf'
    });

    const bobGroupDocMsg = await bobGroupDocPromise;
    assert(Boolean(bobGroupDocMsg), 'Bob received group document message in real time');
    assert(bobGroupDocMsg.messageType === 'file', 'Group message type is "file"');
    assert(bobGroupDocMsg.groupId.toString() === testGroupId, 'Group message groupId matches');

    // Authorization verification:
    // Bob (group member) is authorized to download
    const bobDocDownload = await fetch(
      `http://localhost:${config.port}/api/files/download/${uploadedDocName}`,
      {
        headers: { Authorization: `Bearer ${bobToken}` }
      }
    );
    assert(bobDocDownload.status === 200, 'Group member Bob is authorized to download document (HTTP 200)');

    // Eve (non-group member) is denied access to group attachment
    const eveDocDenied = await fetch(
      `http://localhost:${config.port}/api/files/download/${uploadedDocName}`,
      {
        headers: { Authorization: `Bearer ${eveToken}` }
      }
    );
    assert(eveDocDenied.status === 403, 'Non-group-member Eve is rejected with HTTP 403 Forbidden');

    // ==========================================
    // TEST 7: Regression Check - Text Chat & Previous Phases
    // ==========================================
    console.log('\n[Test 7] Regression Check (Standard Text Messaging & Delivery States)...');

    const bobTextPromise = new Promise((resolve) => {
      socketBob.on('receive-message', (msg) => {
        if (msg.text === 'Standard text message check') resolve(msg);
      });
    });

    socketAlice.emit('send-message', {
      receiver: bobUser._id,
      text: 'Standard text message check',
      messageType: 'text'
    });

    const receivedTextMsg = await bobTextPromise;
    assert(Boolean(receivedTextMsg), 'Standard text message sent and received without conflict');
    assert(receivedTextMsg.status === 'sent', 'Initial status is "sent"');

    // Clean up test files on disk
    try {
      const uploadDirPath = path.resolve(__dirname, '..', 'uploads');
      const testFiles = [uploadedImageName, uploadedDocName];
      testFiles.forEach((f) => {
        const fp = path.join(uploadDirPath, f);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
    } catch (cleanErr) {}

    // Clean up DB records
    await mongoose.connection.collection('users').deleteMany({
      $or: [{ email: aliceData.email }, { email: bobData.email }, { email: eveData.email }]
    });
    await mongoose.connection.collection('groups').deleteOne({ _id: new mongoose.Types.ObjectId(testGroupId) });
    await mongoose.connection.collection('messages').deleteMany({
      $or: [
        { sender: new mongoose.Types.ObjectId(aliceUser._id) },
        { receiver: new mongoose.Types.ObjectId(bobUser._id) },
        { groupId: new mongoose.Types.ObjectId(testGroupId) }
      ]
    });
    await mongoose.connection.collection('files').deleteMany({
      $or: [{ fileName: uploadedImageName }, { fileName: uploadedDocName }]
    });
    console.log('[Cleanup] Test database records and uploaded files cleaned up.');

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 7 TESTS PASSED SUCCESSFULLY!');
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
    if (socketEve) socketEve.disconnect();

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

runPhase7Tests();
