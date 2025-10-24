/**
 * Integration Tests: Passenger Booking Cancellation (US-3.4.3)
 * 
 * Tests cover:
 * - Passenger cancels pending booking (simple status update)
 * - Passenger cancels accepted booking (ledger deallocation + refund trigger)
 * - Optional cancellation reason (audit trail)
 * - Effects summary response
 * - Error cases (ownership, state, not found)
 */

const request = require('supertest');
const app = require('../../src/app');
const SeatLedgerModel = require('../../src/infrastructure/database/models/SeatLedgerModel');
const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');

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

describe('POST /passengers/bookings/:bookingId/cancel - Passenger cancels own booking', () => {
  let driver, passenger, otherPassenger;
  let passengerToken, otherPassengerToken;
  let csrfToken;
  let vehicleId, tripId;

  beforeAll(async () => {
    await connectTestDB();
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
    csrfToken = 'test-csrf-token-passenger-cancel';

    // Create users
    driver = await createTestUser('driver', 'driver-pcancel@unisabana.edu.co');
    passenger = await createTestUser('passenger', 'passenger-pcancel@unisabana.edu.co');
    otherPassenger = await createTestUser('passenger', 'other-passenger@unisabana.edu.co');

    // Tokens
    passengerToken = await loginUser(passenger.corporateEmail);
    otherPassengerToken = await loginUser(otherPassenger.corporateEmail);

    // Setup trip
    vehicleId = await createTestVehicle(driver.id, 'PCANCEL123');
    tripId = await createTestTrip(driver.id, vehicleId, {
      totalSeats: 4,
      status: 'published'
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDB();
  });

  describe('✅ Success Cases - Pending Booking', () => {
    test('200 - Cancel pending booking with reason', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 2,
        status: 'pending'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({ reason: 'Change of plans' })
        .expect(200);

      // Verify response structure
      expect(res.body).toMatchObject({
        id: bookingId,
        status: 'canceled_by_passenger',
        effects: {
          ledgerReleased: 0,  // No ledger for pending
          refundCreated: false
        }
      });

      // Verify booking updated
      const booking = await BookingRequestModel.findById(bookingId);
      expect(booking.status).toBe('canceled_by_passenger');
      expect(booking.cancellationReason).toBe('Change of plans');
      expect(booking.canceledAt).toBeTruthy();
      expect(booking.refundNeeded).toBe(false);

      // Verify no ledger entry exists
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger).toBeNull();
    });

    test('200 - Cancel pending booking without reason', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})  // Empty body
        .expect(200);

      expect(res.body).toMatchObject({
        id: bookingId,
        status: 'canceled_by_passenger',
        effects: {
          ledgerReleased: 0,
          refundCreated: false
        }
      });

      const booking = await BookingRequestModel.findById(bookingId);
      expect(booking.status).toBe('canceled_by_passenger');
      expect(booking.cancellationReason).toBeUndefined();
    });
  });

  describe('✅ Success Cases - Accepted Booking', () => {
    test('200 - Cancel accepted booking (ledger deallocation + refund)', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 2,
        status: 'accepted'
      });

      // Initialize ledger
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 4,
        allocatedSeats: 2
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({ reason: "I can't make it" })
        .expect(200);

      // Verify response with effects
      expect(res.body).toMatchObject({
        id: bookingId,
        status: 'canceled_by_passenger',
        effects: {
          ledgerReleased: 2,  // 2 seats released
          refundCreated: true  // Refund flag set
        }
      });

      // Verify booking updated
      const booking = await BookingRequestModel.findById(bookingId);
      expect(booking.status).toBe('canceled_by_passenger');
      expect(booking.cancellationReason).toBe("I can't make it");
      expect(booking.refundNeeded).toBe(true);  // Internal flag
      expect(booking.canceledAt).toBeTruthy();

      // Verify ledger deallocated
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(0);
      expect(ledger.totalSeats).toBe(4);
    });

    test('200 - Cancel accepted booking with multiple passengers (partial deallocation)', async () => {
      // Two passengers with accepted bookings
      const booking1 = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking2 = await createTestBookingRequest(otherPassenger.id, tripId, {
        seats: 2,
        status: 'accepted'
      });

      // Initialize ledger with 3 allocated seats
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 4,
        allocatedSeats: 3
      });

      // Passenger cancels their booking (1 seat)
      const res = await request(app)
        .post(`/passengers/bookings/${booking1}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(200);

      expect(res.body.effects).toMatchObject({
        ledgerReleased: 1,
        refundCreated: true
      });

      // Verify ledger now shows 2 allocated (3 - 1)
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(2);

      // Other booking still accepted
      const booking2Updated = await BookingRequestModel.findById(booking2);
      expect(booking2Updated.status).toBe('accepted');
    });
  });

  describe('❌ Error Cases', () => {
    test('401 - Unauthenticated request', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .send({})
        .expect(401);

      expect(res.body).toHaveProperty('code', 'unauthorized');
    });

    test('403 - Passenger does not own booking', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(otherPassengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(403);

      expect(res.body).toHaveProperty('code', 'forbidden_owner');

      // Booking remains unchanged
      const booking = await BookingRequestModel.findById(bookingId);
      expect(booking.status).toBe('pending');
    });

    test('403 - CSRF token missing', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', `access_token=${passengerToken}; csrf_token=${csrfToken}`)
        // No X-CSRF-Token header
        .send({})
        .expect(403);

      expect(res.body).toHaveProperty('code', 'csrf_required');
    });

    test('404 - Booking not found', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      const res = await request(app)
        .post(`/passengers/bookings/${fakeId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(404);

      expect(res.body).toHaveProperty('code', 'booking_not_found');
    });

    test('409 - Booking already canceled (idempotency)', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'canceled_by_passenger'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(409);

      expect(res.body).toHaveProperty('code', 'invalid_transition');
      expect(res.body.message).toMatch(/canceled/i);
    });

    test('409 - Cannot cancel declined booking', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'declined'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(409);

      expect(res.body).toHaveProperty('code', 'invalid_transition');
    });

    test('409 - Cannot cancel expired booking', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'expired'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(409);

      expect(res.body).toHaveProperty('code', 'invalid_transition');
    });

    test('400 - Invalid bookingId format', async () => {
      const res = await request(app)
        .post('/passengers/bookings/invalid-id/cancel')
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
    });

    test('400 - Reason too long (max 500 chars)', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const longReason = 'A'.repeat(501);

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({ reason: longReason })
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
      expect(res.body.message).toMatch(/reason/i);
    });
  });

  describe('🔒 Security & Data Integrity', () => {
    test('Accepted booking cancellation is atomic', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 2,
        status: 'accepted'
      });

      await SeatLedgerModel.create({
        tripId,
        totalSeats: 4,
        allocatedSeats: 2
      });

      await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({ reason: 'Testing atomicity' })
        .expect(200);

      // Verify all updates applied together
      const booking = await BookingRequestModel.findById(bookingId);
      const ledger = await SeatLedgerModel.findOne({ tripId });

      expect(booking.status).toBe('canceled_by_passenger');
      expect(booking.refundNeeded).toBe(true);
      expect(ledger.allocatedSeats).toBe(0);
    });

    test('Cancellation reason persisted in audit trail', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const auditReason = 'Emergency came up';

      await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({ reason: auditReason })
        .expect(200);

      const booking = await BookingRequestModel.findById(bookingId);
      expect(booking.cancellationReason).toBe(auditReason);
      expect(booking.canceledAt).toBeInstanceOf(Date);
    });

    test('No PII in error responses', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        // No auth - trigger error
        .send({})
        .expect(401);

      // Verify error has correlationId for tracing
      expect(res.body).toHaveProperty('correlationId');

      // Verify no email or personal data in error
      const responseBody = JSON.stringify(res.body);
      expect(responseBody).not.toMatch(/@unisabana\.edu\.co/);
      expect(responseBody).not.toMatch(/\d{10}/); // No phone numbers
    });

    test('Effects response matches actual database state', async () => {
      const bookingId = await createTestBookingRequest(passenger.id, tripId, {
        seats: 3,
        status: 'accepted'
      });

      await SeatLedgerModel.create({
        tripId,
        totalSeats: 4,
        allocatedSeats: 3
      });

      const res = await request(app)
        .post(`/passengers/bookings/${bookingId}/cancel`)
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .send({})
        .expect(200);

      // Effects report 3 seats released
      expect(res.body.effects.ledgerReleased).toBe(3);

      // Verify ledger actually has 0 allocated
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(0);
    });
  });
});
