const { spawn, execSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase2Tests() {
  console.log('====================================================');
  console.log('      STARTING PHASE 2 COMPLETE AUTHENTICATION TESTS');
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

    // Connect mongoose in test runner to clean up test users
    await mongoose.connect(config.mongoUri);
    const testUsername = `user_${Date.now()}`;
    const testEmail = `${testUsername}@example.com`;
    const testPassword = 'Password123!';

    // --- PHASE 1 REGRESSION CHECKS ---
    console.log('\n--- [PRESERVATION] Phase 1 Regression Checks ---');
    const healthRes = await fetch(`http://localhost:${config.port}/api/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200 && healthData.success === true, 'Phase 1 Health check endpoint is intact');

    // Socket.IO check
    await new Promise((resolve, reject) => {
      const socket = ClientIO(`http://localhost:${config.port}`);
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('Socket.IO ping timeout'));
      }, 4000);

      socket.on('connect', () => socket.emit('ping'));
      socket.on('pong', () => {
        clearTimeout(timer);
        socket.disconnect();
        resolve();
      });
    });
    assert(true, 'Phase 1 Socket.IO connectivity and ping-pong are intact');

    // --- PHASE 2 AUTHENTICATION TESTS ---
    console.log('\n--- [PHASE 2] Authentication & Security Tests ---');

    // 1. Successful Registration
    console.log('\n[Test 1] Testing Successful Registration (POST /api/auth/register)...');
    const regRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        email: testEmail,
        password: testPassword,
        bio: 'Hello world, I am testing!'
      })
    });
    const regData = await regRes.json();

    assert(regRes.status === 201, 'HTTP status is 201 Created');
    assert(regData.success === true, 'Response success is true');
    assert(typeof regData.token === 'string' && regData.token.length > 20, 'JWT token returned upon registration');
    assert(regData.user && regData.user.username === testUsername, 'User profile returned with matching username');
    assert(regData.user.email === testEmail, 'User profile returned with matching email');
    assert(regData.user.password === undefined, 'CRITICAL: Password is NOT exposed in registration response');
    assert(regData.user.bio === 'Hello world, I am testing!', 'User bio preserved');
    assert(regData.user.online !== undefined, 'User online status field present');
    assert(regData.user.lastSeen !== undefined, 'User lastSeen timestamp present');
    assert(regData.user.createdAt !== undefined, 'User createdAt timestamp present');

    const authToken = regData.token;

    // 2. Duplicate Email Prevention
    console.log('\n[Test 2] Testing Duplicate Email Prevention...');
    const dupEmailRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `diff_${Date.now()}`,
        email: testEmail, // Same email
        password: testPassword
      })
    });
    const dupEmailData = await dupEmailRes.json();
    assert(dupEmailRes.status === 400, 'Duplicate email rejected with HTTP 400');
    assert(dupEmailData.success === false, 'Duplicate email response success is false');
    assert(dupEmailData.message.includes('Email is already registered'), 'Appropriate duplicate email message received');

    // 3. Duplicate Username Prevention
    console.log('\n[Test 3] Testing Duplicate Username Prevention...');
    const dupUserRes = await fetch(`http://localhost:${config.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername, // Same username
        email: `diff_${Date.now()}@example.com`,
        password: testPassword
      })
    });
    const dupUserData = await dupUserRes.json();
    assert(dupUserRes.status === 400, 'Duplicate username rejected with HTTP 400');
    assert(dupUserData.success === false, 'Duplicate username response success is false');
    assert(dupUserData.message.includes('Username is already taken'), 'Appropriate duplicate username message received');

    // 4. Successful Login
    console.log('\n[Test 4] Testing Successful Login (POST /api/auth/login)...');
    const loginRes = await fetch(`http://localhost:${config.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword
      })
    });
    const loginData = await loginRes.json();
    assert(loginRes.status === 200, 'HTTP status is 200 OK');
    assert(loginData.success === true, 'Login response success is true');
    assert(typeof loginData.token === 'string' && loginData.token.length > 20, 'JWT token returned on login');
    assert(loginData.user && loginData.user.username === testUsername, 'Correct user profile returned on login');
    assert(loginData.user.password === undefined, 'CRITICAL: Password is NOT exposed in login response');

    // 5. Wrong Password Login Rejection
    console.log('\n[Test 5] Testing Wrong Password Rejection...');
    const wrongPassRes = await fetch(`http://localhost:${config.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'IncorrectPassword999!'
      })
    });
    const wrongPassData = await wrongPassRes.json();
    assert(wrongPassRes.status === 401, 'Wrong password rejected with HTTP 401');
    assert(wrongPassData.success === false, 'Wrong password response success is false');

    // 6. Protected Route Verification (GET /api/auth/me)
    console.log('\n[Test 6] Testing Protected Route with Valid Token (GET /api/auth/me)...');
    const meRes = await fetch(`http://localhost:${config.port}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const meData = await meRes.json();
    assert(meRes.status === 200, 'Protected route returns HTTP 200 with valid token');
    assert(meData.success === true, 'Protected route response success is true');
    assert(meData.user.email === testEmail, 'Protected route returns correct user email');
    assert(meData.user.password === undefined, 'CRITICAL: Password is NOT exposed in protected route');

    // 7. Protected Route with Missing Token
    console.log('\n[Test 7] Testing Protected Route with Missing Token...');
    const noTokenRes = await fetch(`http://localhost:${config.port}/api/auth/me`);
    const noTokenData = await noTokenRes.json();
    assert(noTokenRes.status === 401, 'Missing token rejected with HTTP 401');
    assert(noTokenData.success === false, 'Missing token response success is false');

    // 8. Protected Route with Invalid / Forged Token
    console.log('\n[Test 8] Testing Protected Route with Invalid Token...');
    const badTokenRes = await fetch(`http://localhost:${config.port}/api/auth/me`, {
      headers: { 'Authorization': 'Bearer forged_invalid_jwt_token_payload' }
    });
    const badTokenData = await badTokenRes.json();
    assert(badTokenRes.status === 401, 'Invalid token rejected with HTTP 401');
    assert(badTokenData.success === false, 'Invalid token response success is false');

    // 9. Logout
    console.log('\n[Test 9] Testing User Logout (POST /api/auth/logout)...');
    const logoutRes = await fetch(`http://localhost:${config.port}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const logoutData = await logoutRes.json();
    assert(logoutRes.status === 200, 'Logout returns HTTP 200');
    assert(logoutData.success === true, 'Logout response success is true');

    // 10. Database Password Hash Verification
    console.log('\n[Test 10] Verifying bcrypt password hashing in Database...');
    const dbUser = await mongoose.connection.collection('users').findOne({ email: testEmail });
    assert(dbUser !== null, 'User document found directly in MongoDB');
    assert(dbUser.password !== testPassword, 'Database password does NOT match plaintext password');
    assert(dbUser.password.startsWith('$2'), 'Database password has bcrypt salt signature ($2a$ / $2b$)');

    // Cleanup test user
    await mongoose.connection.collection('users').deleteOne({ email: testEmail });
    console.log('[Cleanup] Test user cleaned up from database.');

    console.log('\n====================================================');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 2 TESTS PASSED SUCCESSFULLY! (10/10)');
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

runPhase2Tests();
