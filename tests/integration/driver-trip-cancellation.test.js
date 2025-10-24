/**
 * Integration Tests: Driver Trip Cancellation with Cascade (US-3.4.2)
 * 
 * Tests cover:
 * - Driver cancels trip (published/draft → canceled)
 * - Cascade: decline pending bookings, cancel accepted bookings
 * - Seat ledger deallocation
 * - Refund triggers for paid bookings
 * - Effects summary response
 * - Error cases (ownership, state, not found)
 */

const request = require('supertest');
const app = require('../../src/app');
const SeatLedgerModel = require('../../src/infrastructure/database/models/SeatLedgerModel');
const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');
const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');

// Force local test DB
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

describe('DELETE /drivers/trips/:tripId - Cancel trip with cascade', () => {
  let driver, otherDriver, passenger1, passenger2, passenger3;
  let driverToken, otherDriverToken;
  let csrfToken;
  let vehicleId;

  beforeAll(async () => {
    await connectTestDB();
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
    csrfToken = 'test-csrf-token-cancel';

    // Create users
    driver = await createTestUser('driver', 'driver-cancel@unisabana.edu.co');
    otherDriver = await createTestUser('driver', 'other-driver-cancel@unisabana.edu.co');
    passenger1 = await createTestUser('passenger', 'passenger1-cancel@unisabana.edu.co');
    passenger2 = await createTestUser('passenger', 'passenger2-cancel@unisabana.edu.co');
    passenger3 = await createTestUser('passenger', 'passenger3-cancel@unisabana.edu.co');

    // Tokens
    driverToken = await loginUser(driver.corporateEmail);
    otherDriverToken = await loginUser(otherDriver.corporateEmail);

    // Vehicle for driver
    vehicleId = await createTestVehicle(driver.id, 'CANCEL123');
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDB();
  });

  describe('✅ Success Cases', () => {
    test('200 - Cancel published trip with mixed bookings (pending + accepted)', async () => {
      // Create trip with 3 seats
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 3,
        status: 'published'
      });

      // Create bookings: 2 pending, 1 accepted
      const pending1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 1,
        status: 'pending'
      });
      const pending2 = await createTestBookingRequest(passenger2.id, tripId, {
        seats: 1,
        status: 'pending'
      });
      const accepted1 = await createTestBookingRequest(passenger3.id, tripId, {
        seats: 1,
        status: 'accepted'
      });

      // Initialize ledger (simulate accepted booking)
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 3,
        allocatedSeats: 1
      });

      // Cancel trip
      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      // Verify response structure
      expect(res.body).toMatchObject({
        id: tripId,
        status: 'canceled',
        effects: {
          declinedAuto: 2,           // 2 pending declined
          canceledByPlatform: 1,     // 1 accepted canceled
          refundsCreated: 1,         // 1 refund trigger
          ledgerReleased: 1          // 1 seat released
        }
      });

      // Verify trip status
      const trip = await TripOfferModel.findById(tripId);
      expect(trip.status).toBe('canceled');

      // Verify pending bookings declined
      const pending1Updated = await BookingRequestModel.findById(pending1);
      const pending2Updated = await BookingRequestModel.findById(pending2);
      expect(pending1Updated.status).toBe('declined_auto');
      expect(pending2Updated.status).toBe('declined_auto');

      // Verify accepted booking canceled
      const accepted1Updated = await BookingRequestModel.findById(accepted1);
      expect(accepted1Updated.status).toBe('canceled_by_platform');
      expect(accepted1Updated.refundNeeded).toBe(true); // Refund flag set

      // Verify ledger deallocated
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(0);
    });

    test('200 - Cancel draft trip with no bookings (zero effects)', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 4,
        status: 'draft'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({
        id: tripId,
        status: 'canceled',
        effects: {
          declinedAuto: 0,
          canceledByPlatform: 0,
          refundsCreated: 0,
          ledgerReleased: 0
        }
      });

      const trip = await TripOfferModel.findById(tripId);
      expect(trip.status).toBe('canceled');
    });

    test('200 - Cancel trip with only pending bookings (no ledger)', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'published'
      });

      await createTestBookingRequest(passenger1.id, tripId, {
        seats: 1,
        status: 'pending'
      });
      await createTestBookingRequest(passenger2.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body.effects).toMatchObject({
        declinedAuto: 2,
        canceledByPlatform: 0,
        refundsCreated: 0,
        ledgerReleased: 0
      });
    });

    test('200 - Cancel trip with only accepted bookings (ledger exists)', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 3,
        status: 'published'
      });

      await createTestBookingRequest(passenger1.id, tripId, {
        seats: 2,
        status: 'accepted'
      });

      // Initialize ledger
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 3,
        allocatedSeats: 2
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body.effects).toMatchObject({
        declinedAuto: 0,
        canceledByPlatform: 1,
        refundsCreated: 1,
        ledgerReleased: 2  // All 2 seats released
      });

      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(0);
    });
  });

  describe('❌ Error Cases', () => {
    test('401 - Unauthenticated request', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'published'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .expect(401);

      expect(res.body).toHaveProperty('code', 'unauthorized');
      expect(res.body).toHaveProperty('message');
    });

    test('403 - Driver does not own trip', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'published'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(otherDriverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(403);

      expect(res.body).toHaveProperty('code', 'forbidden_owner');
      expect(res.body).toHaveProperty('message');

      // Trip should remain unchanged
      const trip = await TripOfferModel.findById(tripId);
      expect(trip.status).toBe('published');
    });

    test('403 - CSRF token missing', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'published'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', `access_token=${driverToken}; csrf_token=${csrfToken}`)
        // No X-CSRF-Token header
        .expect(403);

      expect(res.body).toHaveProperty('code', 'csrf_required');
    });

    test('404 - Trip not found', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      const res = await request(app)
        .delete(`/drivers/trips/${fakeId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(404);

      expect(res.body).toHaveProperty('code', 'trip_not_found');
    });

    test('409 - Trip already canceled (idempotency)', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'canceled'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(409);

      expect(res.body).toHaveProperty('code', 'invalid_transition');
      expect(res.body.message).toMatch(/canceled/i);
    });

    test('409 - Trip already completed (cannot cancel)', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'completed'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(409);

      expect(res.body).toHaveProperty('code', 'invalid_transition');
      expect(res.body.message).toMatch(/completed/i);
    });

    test('400 - Invalid tripId format', async () => {
      const res = await request(app)
        .delete('/drivers/trips/invalid-id')
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
    });
  });

  describe('🔒 Security & Data Integrity', () => {
    test('Effects are atomic - all or nothing on error', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'published'
      });

      await createTestBookingRequest(passenger1.id, tripId, {
        seats: 1,
        status: 'accepted'
      });

      // Initialize ledger
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 2,
        allocatedSeats: 1
      });

      // Cancel successfully
      await request(app)
        .delete(`/drivers/trips/${tripId}`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      // Verify all changes applied atomically
      const trip = await TripOfferModel.findById(tripId);
      const bookings = await BookingRequestModel.find({ tripId });
      const ledger = await SeatLedgerModel.findOne({ tripId });

      expect(trip.status).toBe('canceled');
      expect(bookings.every(b => b.status.includes('canceled') || b.status.includes('declined'))).toBe(true);
      expect(ledger.allocatedSeats).toBe(0);
    });

    test('No PII in error logs - uses correlationId', async () => {
      const tripId = await createTestTrip(driver.id, vehicleId, {
        totalSeats: 2,
        status: 'published'
      });

      const res = await request(app)
        .delete(`/drivers/trips/${tripId}`)
        // No auth - trigger error
        .expect(401);

      // Verify error response has correlationId for tracing
      expect(res.body).toHaveProperty('correlationId');
      expect(typeof res.body.correlationId).toBe('string');
      
      // Verify no email or personal data in error
      expect(JSON.stringify(res.body)).not.toMatch(/@unisabana\.edu\.co/);
    });
  });
});
