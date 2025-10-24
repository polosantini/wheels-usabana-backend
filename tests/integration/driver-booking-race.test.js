/**
 * Integration Tests: Race Condition - Accept Booking Request (Subtask 3.3.6)
 * 
 * Tests concurrent accept operations to prove exactly one success when competing for the last seat.
 * Validates that Seat Ledger atomic operations prevent overbooking.
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

describe('POST /drivers/booking-requests/:bookingId/accept [Race Condition Tests]', () => {
  let driver, passenger1, passenger2, passenger3;
  let driverToken;
  let csrfToken;
  let vehicleId;

  beforeAll(async () => {
    await connectTestDB();
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
    csrfToken = 'test-csrf-token-race';

    // Create users
    driver = await createTestUser('driver', 'driver-race@unisabana.edu.co');
    passenger1 = await createTestUser('passenger', 'p1-race@unisabana.edu.co');
    passenger2 = await createTestUser('passenger', 'p2-race@unisabana.edu.co');
    passenger3 = await createTestUser('passenger', 'p3-race@unisabana.edu.co');

    // Token
    driverToken = await loginUser(driver.corporateEmail);

    // Vehicle for driver
    vehicleId = await createTestVehicle(driver.id, 'XYZ999');
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDB();
  });

  test('Race: N parallel accepts on last seat -> exactly one 200 accepted, N-1 -> 409', async () => {
    // Trip with 1 total seat
    const tripId = await createTestTrip(driver.id, vehicleId, { totalSeats: 1, status: 'published' });
    
    // Create 3 pending booking requests
    const booking1 = await createTestBookingRequest(passenger1.id, tripId, { seats: 1, status: 'pending' });
    const booking2 = await createTestBookingRequest(passenger2.id, tripId, { seats: 1, status: 'pending' });
    const booking3 = await createTestBookingRequest(passenger3.id, tripId, { seats: 1, status: 'pending' });

    console.log(`[Race Test] Trip ${tripId} | 3 pending bookings: ${booking1}, ${booking2}, ${booking3}`);

    // Concurrent accept operations
    const accept = (bookingId) =>
      request(app)
        .post(`/drivers/booking-requests/${bookingId}/accept`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken);

    const results = await Promise.allSettled([
      accept(booking1),
      accept(booking2),
      accept(booking3)
    ]);

    // Extract HTTP status codes
    const statuses = results
      .map((r) => {
        if (r.status === 'fulfilled') {
          return r.value?.status;
        } else {
          // Rejected promises (shouldn't happen, but handle for safety)
          return r.reason?.response?.status || 500;
        }
      })
      .sort((a, b) => a - b); // Sort for consistent assertion

    console.log(`[Race Test] HTTP statuses: ${JSON.stringify(statuses)}`);

    // Expectation: exactly one 200, two 409s
    expect(statuses).toEqual([200, 409, 409]);

    // Verify Seat Ledger shows allocatedSeats = 1 (not oversubscribed)
    const ledger = await SeatLedgerModel.findOne({ tripId });
    expect(ledger).not.toBeNull();
    expect(ledger.allocatedSeats).toBe(1);
    console.log(`[Race Test] Ledger allocatedSeats: ${ledger.allocatedSeats} (expected: 1)`);

    // Verify database: exactly one booking accepted, two remain pending
    const bookingsAfter = await BookingRequestModel.find({ tripId });
    const acceptedCount = bookingsAfter.filter((b) => b.status === 'accepted').length;
    const pendingCount = bookingsAfter.filter((b) => b.status === 'pending').length;

    expect(acceptedCount).toBe(1);
    expect(pendingCount).toBe(2);

    console.log(`[Race Test] Final counts: ${acceptedCount} accepted, ${pendingCount} pending`);
  });

  test('Race: 2 accepts for last seat, then 1 accept after capacity hit -> two 200, one 409', async () => {
    // Trip with 2 total seats
    const tripId = await createTestTrip(driver.id, vehicleId, { totalSeats: 2, status: 'published' });
    
    // Create 3 pending booking requests (each requests 1 seat)
    const booking1 = await createTestBookingRequest(passenger1.id, tripId, { seats: 1, status: 'pending' });
    const booking2 = await createTestBookingRequest(passenger2.id, tripId, { seats: 1, status: 'pending' });
    const booking3 = await createTestBookingRequest(passenger3.id, tripId, { seats: 1, status: 'pending' });

    console.log(`[Race Test Multi] Trip ${tripId} | 3 pending bookings: ${booking1}, ${booking2}, ${booking3}`);

    // Concurrent accept operations
    const accept = (bookingId) =>
      request(app)
        .post(`/drivers/booking-requests/${bookingId}/accept`)
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken);

    const results = await Promise.allSettled([
      accept(booking1),
      accept(booking2),
      accept(booking3)
    ]);

    // Extract HTTP status codes
    const statuses = results
      .map((r) => {
        if (r.status === 'fulfilled') {
          return r.value?.status;
        } else {
          return r.reason?.response?.status || 500;
        }
      })
      .sort((a, b) => a - b);

    console.log(`[Race Test Multi] HTTP statuses: ${JSON.stringify(statuses)}`);

    // Expectation: exactly two 200s (2 seats), one 409
    expect(statuses).toEqual([200, 200, 409]);

    // Verify Seat Ledger shows allocatedSeats = 2 (not oversubscribed)
    const ledger = await SeatLedgerModel.findOne({ tripId });
    expect(ledger).not.toBeNull();
    expect(ledger.allocatedSeats).toBe(2);
    console.log(`[Race Test Multi] Ledger allocatedSeats: ${ledger.allocatedSeats} (expected: 2)`);

    // Verify database: exactly two bookings accepted, one remains pending
    const bookingsAfter = await BookingRequestModel.find({ tripId });
    const acceptedCount = bookingsAfter.filter((b) => b.status === 'accepted').length;
    const pendingCount = bookingsAfter.filter((b) => b.status === 'pending').length;

    expect(acceptedCount).toBe(2);
    expect(pendingCount).toBe(1);

    console.log(`[Race Test Multi] Final counts: ${acceptedCount} accepted, ${pendingCount} pending`);
  });
});
