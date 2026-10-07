const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase9Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 9 POWERFUL SEARCH TESTS');
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

    // Connect mongoose for verification and test data setup
    await mongoose.connect(config.mongoUri);

    // 2. Setup Test Users
    const timestamp = Date.now();
    const aliceData = {
      username: `alice_search_${timestamp}`,
      email: `alice_find_${timestamp}@testdomain.org`,
      password: 'Password123!'
    };
    const bobData = {
      username: `bob_search_${timestamp}`,
      email: `bob_find_${timestamp}@testdomain.org`,
      password: 'Password123!'
    };
    const charlieData = {
      username: `charlie_extra_${timestamp}`,
      email: `charlie_finder_${timestamp}@testdomain.org`,
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

    assert(aliceToken && bobToken && charlieToken, 'Test users registered successfully');

    // ==========================================
    // TEST 1: User Search by Username & Email with Pagination
    // ==========================================
    console.log('\n[Test 1] Testing User Search by Username, Email & Pagination...');

    // 1A. Search by username prefix
    const searchByNameRes = await fetch(
      `http://localhost:${config.port}/api/users/search?q=alice_search`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    const searchByNameJson = await searchByNameRes.json();

    assert(searchByNameRes.status === 200, 'GET /api/users/search returns HTTP 200');
    assert(searchByNameJson.success === true, 'Response contains success: true');
    assert(searchByNameJson.count >= 1, 'Found at least 1 user by username');
    assert(
      searchByNameJson.users.some((u) => u.username === aliceData.username),
      'Matching user found by username query'
    );
    assert(
      !searchByNameJson.users[0].password,
      'Sensitive password field is NOT exposed in search results'
    );

    // 1B. Search by email domain/prefix
    const searchByEmailRes = await fetch(
      `http://localhost:${config.port}/api/users/search?q=testdomain.org`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const searchByEmailJson = await searchByEmailRes.json();

    assert(searchByEmailJson.success === true, 'Search by email domain succeeds');
    assert(
      searchByEmailJson.users.some((u) => u.email === bobData.email),
      'Bob matched by email query'
    );
    assert(
      searchByEmailJson.users.some((u) => u.email === charlieData.email),
      'Charlie matched by email query'
    );

    // 1C. User search pagination
    const paginatedUserRes = await fetch(
      `http://localhost:${config.port}/api/users/search?q=testdomain.org&page=1&limit=1`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const paginatedUserJson = await paginatedUserRes.json();

    assert(paginatedUserJson.count === 1, 'Limit parameter strictly enforced (count = 1)');
    assert(paginatedUserJson.total >= 2, 'Total count reflects full matching population (total >= 2)');
    assert(paginatedUserJson.totalPages >= 2, 'TotalPages calculated accurately');
    assert(paginatedUserJson.page === 1, 'Current page is 1');

    // 1D. Safe handling of special regex characters in user search query
    const regexSafeRes = await fetch(
      `http://localhost:${config.port}/api/users/search?q=.*+?^${encodeURIComponent('{')}()|[]\\`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    assert(
      regexSafeRes.status === 200,
      'Regex special characters handled safely without server error'
    );

    // ==========================================
    // TEST 2: Group Search by Name & Description with Pagination
    // ==========================================
    console.log('\n[Test 2] Testing Group Search by Name, Description & Pagination...');

    // Alice creates two groups: "Frontend Engineers" and "Backend Team"
    const grp1Res = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: `Frontend Engineers ${timestamp}`,
        description: 'React, Vue, and Vanilla JS UI architects',
        members: [bobUser._id]
      })
    });
    const grp1Json = await grp1Res.json();
    const grp1Id = grp1Json.group._id;

    const grp2Res = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        name: `Backend Team ${timestamp}`,
        description: 'Node.js, MongoDB and database scalability',
        members: [bobUser._id]
      })
    });
    const grp2Json = await grp2Res.json();
    const grp2Id = grp2Json.group._id;

    // Charlie creates a private group that Alice and Bob are NOT in
    const charlieGrpRes = await fetch(`http://localhost:${config.port}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${charlieToken}`
      },
      body: JSON.stringify({
        name: `Secret DevOps ${timestamp}`,
        description: 'Kubernetes and infrastructure pipelines',
        members: []
      })
    });
    const charlieGrpJson = await charlieGrpRes.json();
    const secretGrpId = charlieGrpJson.group._id;

    // 2A. Search group by Name
    const groupNameSearchRes = await fetch(
      `http://localhost:${config.port}/api/groups/search?q=Frontend`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const groupNameSearchJson = await groupNameSearchRes.json();

    assert(groupNameSearchRes.status === 200, 'GET /api/groups/search returns HTTP 200');
    assert(groupNameSearchJson.success === true, 'Response contains success: true');
    assert(groupNameSearchJson.count === 1, 'Exactly 1 group found for "Frontend" query');
    assert(
      groupNameSearchJson.groups[0]._id === grp1Id,
      'Matching group ID matches Frontend Engineers'
    );

    // 2B. Search group by Description
    const groupDescSearchRes = await fetch(
      `http://localhost:${config.port}/api/groups/search?q=scalability`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const groupDescSearchJson = await groupDescSearchRes.json();

    assert(groupDescSearchJson.count === 1, 'Group found matching description query "scalability"');
    assert(
      groupDescSearchJson.groups[0]._id === grp2Id,
      'Matching group ID matches Backend Team'
    );

    // 2C. Member isolation: Alice cannot find Charlie\'s secret DevOps group
    const secretSearchRes = await fetch(
      `http://localhost:${config.port}/api/groups/search?q=Secret`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const secretSearchJson = await secretSearchRes.json();
    assert(
      secretSearchJson.count === 0,
      'Group search properly isolated: non-member cannot discover groups'
    );

    // 2D. Group search pagination
    const paginatedGrpRes = await fetch(
      `http://localhost:${config.port}/api/groups/search?page=1&limit=1`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const paginatedGrpJson = await paginatedGrpRes.json();
    assert(paginatedGrpJson.count === 1, 'Group pagination limit enforced');
    assert(paginatedGrpJson.total >= 2, 'Group total reflects all member groups');
    assert(paginatedGrpJson.totalPages >= 2, 'Group totalPages calculated correctly');

    // ==========================================
    // TEST 3: Message Search (Text, Conversation, Date & Global)
    // ==========================================
    console.log('\n[Test 3] Testing Message Search (Text, Conversation, Date, Pagination)...');

    // Create a variety of messages across direct and group conversations
    const pastDate = new Date('2026-01-15T12:00:00Z');
    const recentDate = new Date();

    // Direct Msg 1 (Alice -> Bob): "Quarterly budget report approved" (past date)
    const msg1 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceUser._id),
      receiver: new mongoose.Types.ObjectId(bobUser._id),
      groupId: null,
      text: 'Quarterly budget report approved by finance',
      messageType: 'text',
      status: 'read',
      createdAt: pastDate,
      updatedAt: pastDate
    });

    // Direct Msg 2 (Bob -> Alice): "Great news, deploying frontend updates" (today)
    const msg2 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(bobUser._id),
      receiver: new mongoose.Types.ObjectId(aliceUser._id),
      groupId: null,
      text: 'Great news, deploying frontend updates right now',
      messageType: 'text',
      status: 'read',
      createdAt: recentDate,
      updatedAt: recentDate
    });

    // Group Msg 3 (Alice -> Frontend Group): "Frontend architecture meeting scheduled" (today)
    const msg3 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(aliceUser._id),
      groupId: new mongoose.Types.ObjectId(grp1Id),
      text: 'Frontend architecture meeting scheduled for tomorrow',
      messageType: 'text',
      status: 'sent',
      createdAt: recentDate,
      updatedAt: recentDate
    });

    // Group Msg 4 (Bob -> Backend Group): "Database indexing complete" (today)
    const msg4 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(bobUser._id),
      groupId: new mongoose.Types.ObjectId(grp2Id),
      text: 'Database indexing complete, queries are super fast',
      messageType: 'text',
      status: 'sent',
      createdAt: recentDate,
      updatedAt: recentDate
    });

    // Secret Group Msg 5 (Charlie -> Secret DevOps): "Restricted cluster credentials"
    const msg5 = await mongoose.connection.collection('messages').insertOne({
      sender: new mongoose.Types.ObjectId(charlieUser._id),
      groupId: new mongoose.Types.ObjectId(secretGrpId),
      text: 'Restricted cluster credentials: secret token 9999',
      messageType: 'text',
      status: 'sent',
      createdAt: recentDate,
      updatedAt: recentDate
    });

    // 3A. Global Message Search by text: "frontend" (Matches direct msg2 + group msg3 for Alice)
    const searchMsgTextRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?q=frontend`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const searchMsgTextJson = await searchMsgTextRes.json();

    assert(searchMsgTextRes.status === 200, 'GET /api/messages/search returns HTTP 200');
    assert(searchMsgTextJson.success === true, 'Message search returns success: true');
    assert(searchMsgTextJson.count === 2, 'Found 2 matching messages containing "frontend" for Alice');
    assert(
      searchMsgTextJson.messages.some((m) => m._id === msg2.insertedId.toString()),
      'Matched direct message in search results'
    );
    assert(
      searchMsgTextJson.messages.some((m) => m._id === msg3.insertedId.toString()),
      'Matched group message in search results'
    );
    assert(
      Boolean(searchMsgTextJson.messages[0].sender?.username),
      'Message sender populated with username'
    );

    // 3B. In-Conversation Search: Filter specifically by direct conversation with Bob
    const searchDirectConvRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?userId=${bobUser._id}&q=frontend`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const searchDirectConvJson = await searchDirectConvRes.json();

    assert(searchDirectConvJson.count === 1, 'In-conversation direct search returned exactly 1 match');
    assert(
      searchDirectConvJson.messages[0]._id === msg2.insertedId.toString(),
      'Matched expected message in direct conversation'
    );

    // 3C. In-Conversation Search: Filter specifically by Frontend Group
    const searchGrpConvRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?groupId=${grp1Id}&q=architecture`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const searchGrpConvJson = await searchGrpConvRes.json();

    assert(searchGrpConvJson.count === 1, 'In-conversation group search returned 1 match');
    assert(
      searchGrpConvJson.messages[0]._id === msg3.insertedId.toString(),
      'Matched expected message in group conversation'
    );

    // 3D. Forbidden Conversation Access: Alice attempts to search Secret DevOps group
    const forbiddenSearchRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?groupId=${secretGrpId}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    assert(
      forbiddenSearchRes.status === 403,
      'Access forbidden (HTTP 403) when searching group user is not a member of'
    );

    // 3E. Global Message Isolation: Alice searching for "Restricted" should find 0 results
    const restrictedSearchRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?q=Restricted`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const restrictedSearchJson = await restrictedSearchRes.json();
    assert(
      restrictedSearchJson.count === 0,
      'Global search does not leak messages from non-member groups'
    );

    // 3F. Date Filter Search: Search messages on past date (2026-01-15)
    const dateSearchRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?date=2026-01-15`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const dateSearchJson = await dateSearchRes.json();

    assert(dateSearchJson.count === 1, 'Found message matching exact date (2026-01-15)');
    assert(
      dateSearchJson.messages[0]._id === msg1.insertedId.toString(),
      'Matched past message msg1'
    );

    // 3G. Date Range Search (startDate & endDate)
    const dateRangeRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?startDate=2026-01-01&endDate=2026-01-31`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const dateRangeJson = await dateRangeRes.json();

    assert(dateRangeJson.count === 1, 'Found message matching date range (Jan 2026)');

    // 3H. Message Pagination
    const paginatedMsgRes = await fetch(
      `http://localhost:${config.port}/api/messages/search?page=1&limit=2`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    const paginatedMsgJson = await paginatedMsgRes.json();

    assert(paginatedMsgJson.count === 2, 'Message limit strictly enforced (count = 2)');
    assert(paginatedMsgJson.total >= 4, 'Message total count reflects all accessible messages (>= 4)');
    assert(paginatedMsgJson.totalPages >= 2, 'Message totalPages calculated accurately');
    assert(paginatedMsgJson.page === 1, 'Current page is 1');

    // ==========================================
    // TEST 4: Regression Tests (Phases 1-8 Unbroken)
    // ==========================================
    console.log('\n[Test 4] Verifying Regression Integrity (Phases 1 - 8)...');

    // Health Check
    const healthRes = await fetch(`http://localhost:${config.port}/api/health`);
    assert(healthRes.status === 200, 'GET /api/health returns 200');

    // Direct Messages between users
    const directChatRes = await fetch(
      `http://localhost:${config.port}/api/messages/${aliceUser._id}/${bobUser._id}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    assert(directChatRes.status === 200, 'GET /api/messages/:userId/:otherUserId returns 200');

    // Group Messages
    const groupChatRes = await fetch(
      `http://localhost:${config.port}/api/groups/${grp1Id}/messages`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    assert(groupChatRes.status === 200, 'GET /api/groups/:id/messages returns 200');

    // Notifications
    const notifRes = await fetch(`http://localhost:${config.port}/api/notifications`, {
      headers: { Authorization: `Bearer ${bobToken}` }
    });
    assert(notifRes.status === 200, 'GET /api/notifications returns 200');

    // Cleanup test data
    console.log('\n[Cleanup] Cleaning up test records from database...');
    await mongoose.connection.collection('users').deleteMany({
      $or: [
        { email: aliceData.email },
        { email: bobData.email },
        { email: charlieData.email }
      ]
    });
    await mongoose.connection.collection('groups').deleteMany({
      _id: { $in: [new mongoose.Types.ObjectId(grp1Id), new mongoose.Types.ObjectId(grp2Id), new mongoose.Types.ObjectId(secretGrpId)] }
    });
    await mongoose.connection.collection('messages').deleteMany({
      _id: {
        $in: [
          msg1.insertedId,
          msg2.insertedId,
          msg3.insertedId,
          msg4.insertedId,
          msg5.insertedId
        ]
      }
    });

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 9 TESTS PASSED SUCCESSFULLY!');
    } else {
      console.error(`⚠️ ${testFailures} TEST(S) FAILED!`);
    }
    console.log('====================================================\n');
  } catch (error) {
    console.error('Fatal test error:', error);
    testFailures++;
  } finally {
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

runPhase9Tests();
