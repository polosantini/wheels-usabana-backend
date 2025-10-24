/**
 * Integration Tests: Driver Decline Booking Request (Subtask 3.3.4)
 */

const request = require('supertest');
const app = require('../../src/app');
const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');

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

function cookiePair(accessToken, csrfToken) {
  return `access_token=${accessToken}; csrf_token=${csrfToken}`;
}

describe('POST /drivers/booking-requests/:bookingId/decline', () => {
  let driver1, driver2, passenger;
  let driver1Token, driver2Token;
  let csrfToken;
  let vehicleId;

  beforeAll(async () => {
    await connectTestDB();
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
    csrfToken = 'test-csrf-token-456';

    // Create users
    driver1 = await createTestUser('driver', 'driver1-decline@unisabana.edu.co');
    driver2 = await createTestUser('driver', 'driver2-decline@unisabana.edu.co');
    passenger = await createTestUser('passenger', 'passenger-decline@unisabana.edu.co');

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

  test('200 - pending -> declined (decidedAt present)', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 2, status: 'published' });
    const bookingId = await createTestBookingRequest(passenger.id, tripId, { seats: 1, status: 'pending' });

    const res = await request(app)
      .post(`/drivers/booking-requests/${bookingId}/decline`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    expect(res.body).toMatchObject({
      id: bookingId,
      tripId,
      passengerId: passenger.id,
      status: 'declined',
    });
    expect(res.body).toHaveProperty('decidedAt');
  });

  test('200 - already declined (idempotent)', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 2, status: 'published' });
    const bookingId = await createTestBookingRequest(passenger.id, tripId, { status: 'declined' });

    const res = await request(app)
      .post(`/drivers/booking-requests/${bookingId}/decline`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    expect(res.body).toHaveProperty('status', 'declined');
  });

  test('409 - invalid_state when booking not pending', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 2, status: 'published' });
    const bookingId = await createTestBookingRequest(passenger.id, tripId, { status: 'accepted' });

    const res = await request(app)
      .post(`/drivers/booking-requests/${bookingId}/decline`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(409);

    expect(res.body).toHaveProperty('code', 'invalid_state');
  });

  test('403 - forbidden_owner when another driver attempts decline', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 2, status: 'published' });
    const bookingId = await createTestBookingRequest(passenger.id, tripId, { status: 'pending' });

    const res = await request(app)
      .post(`/drivers/booking-requests/${bookingId}/decline`)
      .set('Cookie', cookiePair(driver2Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(403);

    expect(res.body).toHaveProperty('code', 'forbidden_owner');
  });
});
