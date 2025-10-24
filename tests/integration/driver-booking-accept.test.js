/**
 * Integration Tests: Driver Accept Booking Request (Subtask 3.3.3)
 */

const request = require('supertest');
const app = require('../../src/app');
const SeatLedgerModel = require('../../src/infrastructure/database/models/SeatLedgerModel');
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

describe('POST /drivers/booking-requests/:bookingId/accept', () => {
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
    csrfToken = 'test-csrf-token-123';

    // Create users
    driver1 = await createTestUser('driver', 'driver1-accept@unisabana.edu.co');
    driver2 = await createTestUser('driver', 'driver2-accept@unisabana.edu.co');
    passenger = await createTestUser('passenger', 'passenger-accept@unisabana.edu.co');

    // Tokens
    driver1Token = await loginUser(driver1.corporateEmail);
    driver2Token = await loginUser(driver2.corporateEmail);

    // Vehicle for driver1
  vehicleId = await createTestVehicle(driver1.id, 'ABC123');
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDB();
  });

  test('200 - pending -> accepted; ledger increments exactly once', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 1, status: 'published' });
    const bookingId = await createTestBookingRequest(passenger.id, tripId, { seats: 1, status: 'pending' });

    const res = await request(app)
      .post(`/drivers/booking-requests/${bookingId}/accept`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    expect(res.body).toMatchObject({
      id: bookingId,
      tripId,
      passengerId: passenger.id,
      status: 'accepted'
    });
    expect(res.body).toHaveProperty('decidedAt');

    const ledger = await SeatLedgerModel.findOne({ tripId });
    expect(ledger).not.toBeNull();
    expect(ledger.allocatedSeats).toBe(1);
  });

  test('409 - capacity_exceeded on second accept; booking remains pending', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 1, status: 'published' });
    const booking1 = await createTestBookingRequest(passenger.id, tripId, { seats: 1, note: 'A', status: 'pending' });
    const booking2 = await createTestBookingRequest(passenger.id, tripId, { seats: 1, note: 'B', status: 'pending' });

    // Accept first booking
    await request(app)
      .post(`/drivers/booking-requests/${booking1}/accept`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    // Second accept should fail with capacity_exceeded
    const res = await request(app)
      .post(`/drivers/booking-requests/${booking2}/accept`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(409);

    expect(res.body).toHaveProperty('code', 'capacity_exceeded');

    const bookingDoc = await BookingRequestModel.findById(booking2);
    expect(bookingDoc.status).toBe('pending');
  });

  test('409 - invalid_state when booking not pending', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 2, status: 'published' });
    const bookingId = await createTestBookingRequest(passenger.id, tripId, { status: 'declined' });

    const res = await request(app)
      .post(`/drivers/booking-requests/${bookingId}/accept`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(409);

    expect(res.body).toHaveProperty('code', 'invalid_state');
  });

  test('403 - forbidden_owner when another driver attempts accept', async () => {
    const tripId = await createTestTrip(driver1.id, vehicleId, { totalSeats: 1, status: 'published' });
    const bookingId = await createTestBookingRequest(passenger.id, tripId, { status: 'pending' });

    const res = await request(app)
      .post(`/drivers/booking-requests/${bookingId}/accept`)
      .set('Cookie', cookiePair(driver2Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(403);

    expect(res.body).toHaveProperty('code', 'forbidden_owner');
  });

  test('409 - invalid_trip_state when trip is draft or past', async () => {
    // Draft trip
    const draftTripId = await createTestTrip(driver1.id, vehicleId, { status: 'draft' });
    const draftBooking = await createTestBookingRequest(passenger.id, draftTripId, { status: 'pending' });

    const res1 = await request(app)
      .post(`/drivers/booking-requests/${draftBooking}/accept`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(409);
    expect(res1.body).toHaveProperty('code', 'invalid_trip_state');

    // Past trip
  const now = new Date();
  const past = new Date(now.getTime() - 60 * 60 * 1000);
  // Create a future published trip, then force-update departure to past (bypasses pre-save hook)
  const futureTripId = await createTestTrip(driver1.id, vehicleId, { status: 'published' });
  const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
  await TripOfferModel.updateOne({ _id: futureTripId }, { $set: { departureAt: past, estimatedArrivalAt: now } });
  const pastTripId = futureTripId;
    const pastBooking = await createTestBookingRequest(passenger.id, pastTripId, { status: 'pending' });

    const res2 = await request(app)
      .post(`/drivers/booking-requests/${pastBooking}/accept`)
      .set('Cookie', cookiePair(driver1Token, csrfToken))
      .set('X-CSRF-Token', csrfToken)
      .expect(409);
    expect(res2.body).toHaveProperty('code', 'invalid_trip_state');
  });
});
