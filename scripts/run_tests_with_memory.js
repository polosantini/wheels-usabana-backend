#!/usr/bin/env node
/**
 * Helper to run `npm test` with a mongodb-memory-server instance and required env vars.
 * This avoids modifying tests that expect a MONGO_URI_TEST to be provided.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');

(async () => {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  console.log('Started in-memory MongoDB at', uri);

  const env = Object.assign({}, process.env, {
    MONGO_URI_TEST: uri,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_123',
    JWT_SECRET: process.env.JWT_SECRET || 'test_jwt_secret'
  });

  // Use shell spawn for Windows compatibility
  // Allow passing a test pattern as first CLI arg (e.g. "tests/integration/payments.test.js")
  const testPattern = process.argv[2];
  const testCmd = testPattern ? `npm test -- ${testPattern} --runInBand` : 'npm test -- --runInBand';

  const runner = spawn(testCmd, {
    // Use 'pipe' so we can always capture and duplicate the child's output
    // into a local logfile while still streaming it to the terminal.
    stdio: 'pipe',
    cwd: __dirname + '/..',
    env,
    shell: true
  });

  // Create a logfile in the backend folder (overwritten each run)
  const fs = require('fs');
  const defaultLog = __dirname + '/../test_run_capture.log';
  const logfile = process.env.TEST_LOGFILE || defaultLog;
  const out = fs.createWriteStream(logfile, { flags: 'w' });

  if (runner.stdout && runner.stderr) {
    runner.stdout.pipe(process.stdout);
    runner.stderr.pipe(process.stderr);

    // Also duplicate into the log file
    runner.stdout.pipe(out);
    runner.stderr.pipe(out);
  }

  // Close the stream when the runner exits
  runner.on('exit', async (code) => {
    out.end();
    console.log('Tests finished with code', code);
    try {
      await mongod.stop();
      console.log('Stopped in-memory MongoDB');
    } catch (err) {
      console.error('Error stopping MongoDB memory server', err);
    }
    process.exit(code);
  });
})();
