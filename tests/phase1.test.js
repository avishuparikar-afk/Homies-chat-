const { spawn, execSync } = require('child_process');
const path = require('path');
const { io: ClientIO } = require('socket.io-client');
const config = require('../server/config/app.config');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase1Tests() {
  console.log('--- STARTING PHASE 1 VERIFICATION TESTS ---');
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
    // Wait for server to start and MongoDB to connect
    console.log('[Setup] Waiting for server initialization...');
    let isServerReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://localhost:${config.port}/api/health`);
        if (res.ok) {
          isServerReady = true;
          break;
        }
      } catch (err) {
        // Not ready yet
      }
      await sleep(500);
    }

    assert(isServerReady, 'Server initialized and responding to HTTP requests');

    // Test 1: GET /api/health
    console.log('\n[Test 1] Verifying GET /api/health Endpoint...');
    const healthRes = await fetch(`http://localhost:${config.port}/api/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, 'HTTP status is 200');
    assert(healthData.success === true, 'Response JSON success is true');
    assert(healthData.message === 'Server is running', 'Response JSON message is "Server is running"');

    // Test 2: Static frontend HTML
    console.log('\n[Test 2] Verifying Frontend Static File Serving...');
    const indexRes = await fetch(`http://localhost:${config.port}/`);
    const indexHtml = await indexRes.text();
    assert(indexRes.status === 200, 'GET / returns HTTP 200');
    assert(indexHtml.includes('Real-Time Chat Application'), 'HTML contains application title');

    // Test 3: 404 Route Handler
    console.log('\n[Test 3] Verifying 404 Error Handler...');
    const notFoundRes = await fetch(`http://localhost:${config.port}/api/unknown_route`);
    const notFoundData = await notFoundRes.json();
    assert(notFoundRes.status === 404, 'Non-existent route returns HTTP 404');
    assert(notFoundData.success === false, '404 Response contains success: false');

    // Test 4: Socket.IO Connection & Ping-Pong
    console.log('\n[Test 4] Verifying Socket.IO Real-time Connection...');
    await new Promise((resolve, reject) => {
      const socket = ClientIO(`http://localhost:${config.port}`, {
        transports: ['websocket', 'polling']
      });

      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(new Error('Socket.IO ping/pong timed out'));
      }, 5000);

      socket.on('connect', () => {
        assert(true, `Socket connected successfully with ID: ${socket.id}`);
        socket.emit('ping');
      });

      socket.on('pong', (payload) => {
        assert(payload && payload.timestamp, 'Received pong event with server timestamp');
        clearTimeout(timeout);
        socket.disconnect();
        resolve();
      });

      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        socket.disconnect();
        reject(err);
      });
    });

    console.log('\n----------------------------------------');
    if (testFailures === 0) {
      console.log('🎉 ALL PHASE 1 TESTS PASSED SUCCESSFULLY!');
    } else {
      console.error(`⚠️ ${testFailures} TEST(S) FAILED!`);
    }
    console.log('----------------------------------------\n');

  } catch (error) {
    console.error('Fatal test error:', error);
    testFailures++;
  } finally {
    // Terminate the child process cleanly on Windows
    try {
      if (serverProcess && serverProcess.pid) {
        execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
      }
    } catch (e) {
      // Process already closed
    }
    await sleep(500);
    process.exitCode = testFailures > 0 ? 1 : 0;
  }
}

runPhase1Tests();
