/**
 * Jest Setup File
 * 
 * Runs before all tests to configure the test environment
 */

// Load environment variables
require('dotenv').config();

// Set NODE_ENV to 'test' if not already set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

// Increase timeout for integration tests with database
jest.setTimeout(30000);

// Suppress console.log during tests (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

// Verify critical environment variables
if (!process.env.MONGODB_URI) {
  console.error('⚠ WARNING: MONGODB_URI not set in .env file');
  console.error('⚠ Tests may fail without database connection');
}

if (!process.env.JWT_SECRET) {
  console.warn('⚠ WARNING: JWT_SECRET not set, using default (not secure for production)');
}

console.log('✓ Jest setup complete');
console.log(`✓ Environment: ${process.env.NODE_ENV || 'test'}`);
console.log(`✓ MongoDB URI: ${process.env.MONGODB_URI ? 'Configured' : 'Missing'}`);
