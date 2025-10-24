/**
 * Integration Tests: Seat Ledger Race Conditions (US-3.4 Critical)
 * 
 * **Purpose**: Prove atomic ledger operations with concurrent cancellations
 * 
 * Tests cover:
 * - Concurrent passenger cancellations (accepted bookings)
 * - Concurrent accept + cancel operations
 * - Driver trip cancellation during passenger cancellations
 * - No over-deallocation (allocatedSeats never goes negative)
 * - No under-deallocation (all seats properly released)
 * - Ledger integrity under race conditions
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

describe('Seat Ledger Race Conditions - Cancellation Flow', () => {
  let driver, passenger1, passenger2, passenger3, passenger4;
  let driverToken, p1Token, p2Token, p3Token, p4Token;
  let csrfToken;
  let vehicleId, tripId;

  beforeAll(async () => {
    await connectTestDB();
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
    csrfToken = 'test-csrf-race';

    // Create users
    driver = await createTestUser('driver', 'driver-race@unisabana.edu.co');
    passenger1 = await createTestUser('passenger', 'p1-race@unisabana.edu.co');
    passenger2 = await createTestUser('passenger', 'p2-race@unisabana.edu.co');
    passenger3 = await createTestUser('passenger', 'p3-race@unisabana.edu.co');
    passenger4 = await createTestUser('passenger', 'p4-race@unisabana.edu.co');

    // Tokens
    driverToken = await loginUser(driver.corporateEmail);
    p1Token = await loginUser(passenger1.corporateEmail);
    p2Token = await loginUser(passenger2.corporateEmail);
    p3Token = await loginUser(passenger3.corporateEmail);
    p4Token = await loginUser(passenger4.corporateEmail);

    // Setup trip
    vehicleId = await createTestVehicle(driver.id, 'RACE123');
    tripId = await createTestTrip(driver.id, vehicleId, {
      totalSeats: 5,
      status: 'published'
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDB();
  });

  describe('🏁 Concurrent Passenger Cancellations', () => {
    test('Race: 3 passengers cancel accepted bookings simultaneously (no under-deallocation)', async () => {
      // Create 3 accepted bookings
      const booking1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking2 = await createTestBookingRequest(passenger2.id, tripId, {
        seats: 2,
        status: 'accepted'
      });
      const booking3 = await createTestBookingRequest(passenger3.id, tripId, {
        seats: 1,
        status: 'accepted'
      });

      // Initialize ledger with 4 allocated seats
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 5,
        allocatedSeats: 4
      });

      // Cancel all 3 bookings in parallel
      const results = await Promise.all([
        request(app)
          .post(`/passengers/bookings/${booking1}/cancel`)
          .set('Cookie', cookiePair(p1Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({ reason: 'Passenger 1 cancels' }),
        request(app)
          .post(`/passengers/bookings/${booking2}/cancel`)
          .set('Cookie', cookiePair(p2Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({ reason: 'Passenger 2 cancels' }),
        request(app)
          .post(`/passengers/bookings/${booking3}/cancel`)
          .set('Cookie', cookiePair(p3Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({ reason: 'Passenger 3 cancels' })
      ]);

      // All should succeed
      expect(results.every(r => r.status === 200)).toBe(true);

      // Verify ledger integrity
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(0);  // All 4 seats released (1 + 2 + 1)
      expect(ledger.allocatedSeats).toBeGreaterThanOrEqual(0);  // Never negative!

      // Verify all bookings canceled
      const bookings = await BookingRequestModel.find({
        _id: { $in: [booking1, booking2, booking3] }
      });
      expect(bookings.every(b => b.status === 'canceled_by_passenger')).toBe(true);
      expect(bookings.every(b => b.refundNeeded === true)).toBe(true);
    });

    test('Race: 4 passengers cancel simultaneously (stress test)', async () => {
      // Create 4 accepted bookings (1 seat each)
      const booking1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking2 = await createTestBookingRequest(passenger2.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking3 = await createTestBookingRequest(passenger3.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking4 = await createTestBookingRequest(passenger4.id, tripId, {
        seats: 1,
        status: 'accepted'
      });

      // Initialize ledger with 4 allocated
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 5,
        allocatedSeats: 4
      });

      // Cancel all 4 in parallel
      const results = await Promise.all([
        request(app)
          .post(`/passengers/bookings/${booking1}/cancel`)
          .set('Cookie', cookiePair(p1Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking2}/cancel`)
          .set('Cookie', cookiePair(p2Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking3}/cancel`)
          .set('Cookie', cookiePair(p3Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking4}/cancel`)
          .set('Cookie', cookiePair(p4Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({})
      ]);

      // All should succeed
      expect(results.every(r => r.status === 200)).toBe(true);

      // Critical: Verify no over-deallocation
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(0);
      expect(ledger.allocatedSeats).toBeGreaterThanOrEqual(0);

      // Sum of released seats from responses
      const totalReleased = results.reduce((sum, r) => sum + r.body.effects.ledgerReleased, 0);
      expect(totalReleased).toBe(4);  // 1 + 1 + 1 + 1
    });
  });

  describe('🏁 Concurrent Accept + Cancel Operations', () => {
    test('Race: Accept booking while another passenger cancels', async () => {
      // Passenger 1 has accepted booking
      const booking1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 2,
        status: 'accepted'
      });

      // Passenger 2 has pending booking
      const booking2 = await createTestBookingRequest(passenger2.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      // Initialize ledger
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 5,
        allocatedSeats: 2
      });

      // Race: P1 cancels, driver accepts P2
      const [cancelRes, acceptRes] = await Promise.all([
        request(app)
          .post(`/passengers/bookings/${booking1}/cancel`)
          .set('Cookie', cookiePair(p1Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/drivers/booking-requests/${booking2}/accept`)
          .set('Cookie', cookiePair(driverToken, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({})
      ]);

      // Both operations should succeed
      expect(cancelRes.status).toBe(200);
      expect(acceptRes.status).toBe(200);

      // Ledger integrity: 2 released, 1 allocated = 1 final
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBe(1);
      expect(ledger.allocatedSeats).toBeGreaterThanOrEqual(0);
    });
  });

  describe('🏁 Driver Trip Cancellation During Passenger Cancellations', () => {
    test('Race: Driver cancels trip while passengers cancel bookings', async () => {
      // Create bookings
      const booking1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking2 = await createTestBookingRequest(passenger2.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking3 = await createTestBookingRequest(passenger3.id, tripId, {
        seats: 1,
        status: 'pending'
      });

      // Initialize ledger
      await SeatLedgerModel.create({
        tripId,
        totalSeats: 5,
        allocatedSeats: 2
      });

      // Race: Passengers cancel + driver cancels trip
      const results = await Promise.allSettled([
        request(app)
          .post(`/passengers/bookings/${booking1}/cancel`)
          .set('Cookie', cookiePair(p1Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking2}/cancel`)
          .set('Cookie', cookiePair(p2Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .delete(`/drivers/trips/${tripId}`)
          .set('Cookie', cookiePair(driverToken, csrfToken))
          .set('X-CSRF-Token', csrfToken)
      ]);

      // At least one operation should succeed
      const successfulOps = results.filter(r => r.status === 'fulfilled' && r.value.status === 200);
      expect(successfulOps.length).toBeGreaterThan(0);

      // Verify final state
      const trip = await TripOfferModel.findById(tripId);
      const ledger = await SeatLedgerModel.findOne({ tripId });
      const bookings = await BookingRequestModel.find({ tripId });

      // Trip should be canceled
      expect(trip.status).toBe('canceled');

      // Ledger should be deallocated (by trip cancel or passenger cancels)
      expect(ledger.allocatedSeats).toBe(0);
      expect(ledger.allocatedSeats).toBeGreaterThanOrEqual(0);

      // All bookings should be in terminal states
      const terminalStates = ['canceled_by_passenger', 'canceled_by_platform', 'declined_auto'];
      expect(bookings.every(b => terminalStates.includes(b.status))).toBe(true);
    });

    test('Race: Driver cancels while passenger tries to cancel (409 or 200)', async () => {
      const booking1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 2,
        status: 'accepted'
      });

      await SeatLedgerModel.create({
        tripId,
        totalSeats: 5,
        allocatedSeats: 2
      });

      // Simultaneously: driver cancels trip, passenger cancels booking
      const [driverRes, passengerRes] = await Promise.allSettled([
        request(app)
          .delete(`/drivers/trips/${tripId}`)
          .set('Cookie', cookiePair(driverToken, csrfToken))
          .set('X-CSRF-Token', csrfToken),
        request(app)
          .post(`/passengers/bookings/${booking1}/cancel`)
          .set('Cookie', cookiePair(p1Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({})
      ]);

      // Possible outcomes:
      // 1. Driver wins: trip canceled, booking auto-canceled (passenger gets 409)
      // 2. Passenger wins: booking canceled, then trip canceled
      // 3. Both succeed (transaction ordering)

      // At least one should succeed
      const statuses = [
        driverRes.status === 'fulfilled' ? driverRes.value.status : null,
        passengerRes.status === 'fulfilled' ? passengerRes.value.status : null
      ];
      expect(statuses).toContain(200);

      // Final state: trip canceled, ledger deallocated
      const trip = await TripOfferModel.findById(tripId);
      const ledger = await SeatLedgerModel.findOne({ tripId });

      expect(trip.status).toBe('canceled');
      expect(ledger.allocatedSeats).toBe(0);
    });
  });

  describe('🔒 Ledger Integrity Guarantees', () => {
    test('Ledger never goes negative with concurrent operations', async () => {
      // Create multiple accepted bookings
      const bookings = await Promise.all([
        createTestBookingRequest(passenger1.id, tripId, { seats: 1, status: 'accepted' }),
        createTestBookingRequest(passenger2.id, tripId, { seats: 1, status: 'accepted' }),
        createTestBookingRequest(passenger3.id, tripId, { seats: 1, status: 'accepted' })
      ]);

      await SeatLedgerModel.create({
        tripId,
        totalSeats: 5,
        allocatedSeats: 3
      });

      // Cancel all + try to cancel again (idempotency test)
      const operations = [
        ...bookings.map(id => 
          request(app)
            .post(`/passengers/bookings/${id}/cancel`)
            .set('Cookie', cookiePair(p1Token, csrfToken))
            .set('X-CSRF-Token', csrfToken)
            .send({})
        ),
        ...bookings.map(id => 
          request(app)
            .post(`/passengers/bookings/${id}/cancel`)
            .set('Cookie', cookiePair(p1Token, csrfToken))
            .set('X-CSRF-Token', csrfToken)
            .send({})
        )
      ];

      await Promise.allSettled(operations);

      // Critical: Ledger must never go negative
      const ledger = await SeatLedgerModel.findOne({ tripId });
      expect(ledger.allocatedSeats).toBeGreaterThanOrEqual(0);
      expect(ledger.allocatedSeats).toBe(0);
    });

    test('Total deallocations match allocated seats', async () => {
      const TOTAL_SEATS = 5;
      const ALLOCATED = 4;

      // Create bookings: 2 seats, 1 seat, 1 seat
      const booking1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 2,
        status: 'accepted'
      });
      const booking2 = await createTestBookingRequest(passenger2.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking3 = await createTestBookingRequest(passenger3.id, tripId, {
        seats: 1,
        status: 'accepted'
      });

      await SeatLedgerModel.create({
        tripId,
        totalSeats: TOTAL_SEATS,
        allocatedSeats: ALLOCATED
      });

      const initialLedger = await SeatLedgerModel.findOne({ tripId });
      const initialAllocated = initialLedger.allocatedSeats;

      // Cancel all
      const results = await Promise.all([
        request(app)
          .post(`/passengers/bookings/${booking1}/cancel`)
          .set('Cookie', cookiePair(p1Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking2}/cancel`)
          .set('Cookie', cookiePair(p2Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking3}/cancel`)
          .set('Cookie', cookiePair(p3Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({})
      ]);

      // Sum released seats
      const totalReleased = results.reduce((sum, r) => sum + r.body.effects.ledgerReleased, 0);

      // Critical: Total released must equal initial allocated
      expect(totalReleased).toBe(initialAllocated);
      expect(totalReleased).toBe(ALLOCATED);

      // Final ledger check
      const finalLedger = await SeatLedgerModel.findOne({ tripId });
      expect(finalLedger.allocatedSeats).toBe(0);
    });
  });

  describe('📊 Metrics Accuracy Under Concurrency', () => {
    test('Effects summary accurately reflects concurrent operations', async () => {
      // 3 accepted bookings
      const booking1 = await createTestBookingRequest(passenger1.id, tripId, {
        seats: 1,
        status: 'accepted'
      });
      const booking2 = await createTestBookingRequest(passenger2.id, tripId, {
        seats: 2,
        status: 'accepted'
      });
      const booking3 = await createTestBookingRequest(passenger3.id, tripId, {
        seats: 1,
        status: 'accepted'
      });

      await SeatLedgerModel.create({
        tripId,
        totalSeats: 5,
        allocatedSeats: 4
      });

      // Cancel all concurrently
      const results = await Promise.all([
        request(app)
          .post(`/passengers/bookings/${booking1}/cancel`)
          .set('Cookie', cookiePair(p1Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking2}/cancel`)
          .set('Cookie', cookiePair(p2Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({}),
        request(app)
          .post(`/passengers/bookings/${booking3}/cancel`)
          .set('Cookie', cookiePair(p3Token, csrfToken))
          .set('X-CSRF-Token', csrfToken)
          .send({})
      ]);

      // Verify each response reports correct ledger release
      expect(results[0].body.effects.ledgerReleased).toBe(1);
      expect(results[1].body.effects.ledgerReleased).toBe(2);
      expect(results[2].body.effects.ledgerReleased).toBe(1);

      // All should report refund created
      expect(results.every(r => r.body.effects.refundCreated === true)).toBe(true);

      // Verify database matches reported effects
      const finalLedger = await SeatLedgerModel.findOne({ tripId });
      const totalReportedReleased = results.reduce((sum, r) => sum + r.body.effects.ledgerReleased, 0);
      
      expect(totalReportedReleased).toBe(4);
      expect(finalLedger.allocatedSeats).toBe(0);
    });
  });
});
