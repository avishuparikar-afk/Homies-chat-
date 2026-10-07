const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase3Tests() {
  console.log('====================================================');
  console.log('      STARTING PHASE 3 USER PROFILE MANAGEMENT TESTS');
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

    // Connect mongoose in test runner for verification and cleanup
    await mongoose.connect(config.mongoUri);

    // --- PHASE 1 & 2 REGRESSION CHECKS ---
    console.log('\n--- [PRESERVATION] Phase 1 & 2 Regressions ---');
    const healthRes = await fetch(`http://localhost:${config.port}/api/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200 && healthData.success === true, 'Phase 1 Health check endpoint is intact');

    // Setup 2 test users
    const timestamp = Date.now();
    const userAData = {
      username: `alice_${timestamp}`,
      email: `alice_${timestamp}@example.com`,
      password: 'AlicePassword123!',
      bio: 'Alice original bio'
    };
    const userBData = {
      username: `bob_${timestamp}`,
      email: `bob_${timestamp}@example.com`,
      password: 'BobPassword123!',
      bio: 'Bob original bio'
    };

    const regA = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userAData)
    });
    const regAJson = await regA.json();
    const tokenA = regAJson.token;
    const userA = regAJson.user;

    const regB = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userBData)
    });
    const regBJson = await regB.json();
    const tokenB = regBJson.token;
    const userB = regBJson.user;

    assert(tokenA && tokenB, 'Phase 2 User registration and token generation intact');

    // --- PHASE 3 TESTS ---
    console.log('\n--- [PHASE 3] User Profile Management Tests ---');

    // Test 1: GET /api/users (User list, excluding requesting user, no passwords)
    console.log('\n[Test 1] Testing GET /api/users (User Directory)...');
    const listRes = await fetch(`http://localhost:${config.port}/api/users`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const listData = await listRes.json();

    assert(listRes.status === 200, 'GET /api/users returns HTTP 200');
    assert(listData.success === true, 'Response contains success: true');
    assert(Array.isArray(listData.users), 'Response contains array of users');
    assert(listData.users.some((u) => u._id === userB._id), 'User list contains other registered users (User B)');
    assert(!listData.users.some((u) => u._id === userA._id), 'User list excludes the requesting user (User A)');
    assert(listData.users.every((u) => u.password === undefined), 'CRITICAL: No passwords exposed in user list');

    // Test 2: GET /api/users/:id (View profile by ID)
    console.log('\n[Test 2] Testing GET /api/users/:id (View Profile)...');
    const getUserRes = await fetch(`http://localhost:${config.port}/api/users/${userB._id}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const getUserData = await getUserRes.json();

    assert(getUserRes.status === 200, 'GET /api/users/:id returns HTTP 200');
    assert(getUserData.success === true, 'Response contains success: true');
    assert(getUserData.user && getUserData.user.username === userBData.username, 'Returned profile matches requested user');
    assert(getUserData.user.password === undefined, 'CRITICAL: No password exposed in user profile view');
    assert(getUserData.user.online !== undefined, 'User profile contains online status');
    assert(getUserData.user.lastSeen !== undefined, 'User profile contains lastSeen timestamp');

    // Test 3: GET /api/users/:id Invalid format & Not found
    console.log('\n[Test 3] Testing GET /api/users/:id error handling...');
    const badIdRes = await fetch(`http://localhost:${config.port}/api/users/invalid-mongo-id`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(badIdRes.status === 400, 'Invalid ObjectId format returns HTTP 400');

    const notFoundId = new mongoose.Types.ObjectId();
    const notFoundRes = await fetch(`http://localhost:${config.port}/api/users/${notFoundId}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent user ID returns HTTP 404');

    // Test 4: PUT /api/users/profile (Update username, bio, profileImage)
    console.log('\n[Test 4] Testing PUT /api/users/profile (Edit Profile)...');
    const updatedUsername = `alice_updated_${timestamp}`;
    const updatedBio = 'This is my newly updated bio!';
    const updatedAvatar = '🚀';

    const updateRes = await fetch(`http://localhost:${config.port}/api/users/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        username: updatedUsername,
        bio: updatedBio,
        profileImage: updatedAvatar
      })
    });
    const updateData = await updateRes.json();

    assert(updateRes.status === 200, 'PUT /api/users/profile returns HTTP 200');
    assert(updateData.success === true, 'Update response success is true');
    assert(updateData.user.username === updatedUsername, 'Username successfully updated');
    assert(updateData.user.bio === updatedBio, 'Bio successfully updated');
    assert(updateData.user.profileImage === updatedAvatar, 'Profile image successfully updated');
    assert(updateData.user.password === undefined, 'CRITICAL: Password is NOT exposed in update response');

    // Verify persistence via GET /api/auth/me
    const verifyMe = await fetch(`http://localhost:${config.port}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const verifyMeData = await verifyMe.json();
    assert(verifyMeData.user.username === updatedUsername, 'Updated profile persisted and confirmed via GET /api/auth/me');

    // Test 5: PUT /api/users/profile Duplicate Username Rejection
    console.log('\n[Test 5] Testing PUT /api/users/profile Duplicate Username Prevention...');
    const dupUpdateRes = await fetch(`http://localhost:${config.port}/api/users/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        username: userBData.username // Attempt to steal user B's username
      })
    });
    const dupUpdateData = await dupUpdateRes.json();
    assert(dupUpdateRes.status === 400, 'Duplicate username update rejected with HTTP 400');
    assert(dupUpdateData.message.includes('Username is already taken'), 'Descriptive duplicate username error returned');

    // Test 6: GET /api/users/search?q= (User Search)
    console.log('\n[Test 6] Testing GET /api/users/search?q=...');
    const searchRes = await fetch(`http://localhost:${config.port}/api/users/search?q=${userBData.username}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const searchData = await searchRes.json();

    assert(searchRes.status === 200, 'Search endpoint returns HTTP 200');
    assert(searchData.success === true, 'Search response success is true');
    assert(searchData.users.length >= 1, 'Search finds matching user');
    assert(searchData.users.some((u) => u.username === userBData.username), 'Search results contain User B');
    assert(searchData.users.every((u) => u.password === undefined), 'CRITICAL: No passwords exposed in search results');

    // Search empty query returns empty list
    const emptySearchRes = await fetch(`http://localhost:${config.port}/api/users/search?q=`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const emptySearchData = await emptySearchRes.json();
    assert(emptySearchData.users.length === 0, 'Empty search query safely returns empty array');

    // Test 7: Unauthorized Access Protection
    console.log('\n[Test 7] Testing Unauthorized Access Protection...');
    const unauthList = await fetch(`http://localhost:${config.port}/api/users`);
    assert(unauthList.status === 401, 'GET /api/users without token returns HTTP 401');

    const unauthProfile = await fetch(`http://localhost:${config.port}/api/users/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: 'hack' })
    });
    assert(unauthProfile.status === 401, 'PUT /api/users/profile without token returns HTTP 401');

    const unauthSearch = await fetch(`http://localhost:${config.port}/api/users/search?q=alice`);
    assert(unauthSearch.status === 401, 'GET /api/users/search without token returns HTTP 401');

    // Cleanup test users
    await mongoose.connection.collection('users').deleteMany({
      $or: [
        { email: userAData.email },
        { email: userBData.email }
      ]
    });
    console.log('[Cleanup] Test users removed from MongoDB.');

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 3 TESTS PASSED SUCCESSFULLY!');
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

runPhase3Tests();
