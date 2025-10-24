/**
 * Integration Tests: Driver Capacity Snapshot (Subtask 3.3.5)
 */

const request = require('supertest');
const app = require('../../src/app');
// Force local test DB to avoid remote cluster during integration tests
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wheels-unisabana-test';
const {
  connectTestDB,
  disconnectTestDB,
  createTestUser,
  loginUser,
  createTestVehicle,
  createTestTrip,
  createTestBookingRequest,
  cleanupTestData
} = require('../helpers/testHelpers');

function cookie(accessToken, csrfToken = 'test-csrf-token-123') {
  return `access_token=${accessToken}; csrf_token=${csrfToken}`;
}

describe('GET /drivers/trips/:tripId/capacity', () => {
  let driver1, driver2, passenger;
  let driver1Token, driver2Token;
  let vehicleId;

  beforeAll(async () => {
    await connectTestDB();
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();

    // Users
    driver1 = await createTestUser('driver', 'driver1-capacity@unisabana.edu.co');
    driver2 = await createTestUser('driver', 'driver2-capacity@unisabana.edu.co');
    passenger = await createTestUser('passenger', 'passenger-capacity@unisabana.edu.co');

    // Tokens
    driver1Token = await loginUser(driver1.corporateEmail);
    driver2Token = await loginUser(driver2.corporateEmail);

    // Vehicle for driver1
    vehicleId = await createTestVehicle(driver1.id, 'ABD123');
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDB();
  });

  test('200 - owner retrieves numbers { totalSeats, allocatedSeats, remainingSeats }', async () => {
    // Trip with 3 seats
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 3, status: 'published' });

    // Create two pending bookings and accept them to allocate 2 seats
    const csrfToken = 'test-csrf-token-123';
    const bookingA = await createTestBookingRequest(passenger.id, tripId, { seats: 1, status: 'pending' });
    const bookingB = await createTestBookingRequest(passenger.id, tripId, { seats: 1, status: 'pending' });

    await request(app)
      .post(`/drivers/booking-requests/${bookingA}/accept`)
      .set('Cookie', cookie(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    await request(app)
      .post(`/drivers/booking-requests/${bookingB}/accept`)
      .set('Cookie', cookie(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    const res = await request(app)
      .get(`/drivers/trips/${tripId}/capacity`)
      .set('Cookie', cookie(driver1Token))
      .expect(200);

    expect(res.body).toMatchObject({
      totalSeats: 3,
      allocatedSeats: 2,
      remainingSeats: 1
    });
  });

  test('403 - non-owner receives forbidden_owner', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 3, status: 'published' });

    const res = await request(app)
      .get(`/drivers/trips/${tripId}/capacity`)
      .set('Cookie', cookie(driver2Token))
      .expect(403);

    expect(res.body).toHaveProperty('code', 'forbidden_owner');
  });
});
