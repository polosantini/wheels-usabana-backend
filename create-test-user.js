/**
 * Create Test User Script
 * 
 * Creates a test passenger user for testing payment intents
 */

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const TEST_USER = {
  firstName: 'Test',
  lastName: 'Passenger',
  corporateEmail: 'test.passenger2@unisabana.edu.co',
  password: 'TestPass123',
  universityId: '1234567891',
  phone: '+573001234568',
  role: 'passenger'
};

async function createTestUser() {
  try {
    console.log('👤 Creating test passenger user...');
    console.log(`📧 Email: ${TEST_USER.corporateEmail}`);
    console.log(`🔑 Password: ${TEST_USER.password}\n`);

    const response = await axios.post(`${BASE_URL}/auth/register`, TEST_USER, {
      headers: {
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });

    console.log(`📊 Status: ${response.status}`);
    console.log(`📦 Response:`, JSON.stringify(response.data, null, 2));

    if (response.status === 201) {
      console.log('✅ Test user created successfully!');
      console.log('\n🎉 You can now run the payment intent tests:');
      console.log('   node test-payment-intent-auth.js');
      return true;
    } else if (response.status === 409) {
      console.log('ℹ️  User already exists - that\'s fine!');
      console.log('\n🎉 You can now run the payment intent tests:');
      console.log('   node test-payment-intent-auth.js');
      return true;
    } else {
      console.log('❌ Failed to create test user');
      return false;
    }

  } catch (error) {
    console.log('❌ Error creating test user:', error.message);
    if (error.response) {
      console.log(`📊 Error Status: ${error.response.status}`);
      console.log(`📦 Error Response:`, JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Run if this file is executed directly
if (require.main === module) {
  createTestUser()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { createTestUser, TEST_USER };
