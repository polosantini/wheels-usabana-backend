/**
 * Integration Tests: Lifecycle Jobs (US-3.4.4)
 * 
 * Tests cover:
 * - POST /internal/jobs/run (admin-only)
 * - complete-trips: Auto-complete published trips past arrival
 * - expire-pendings: Expire old pending bookings
 * - auto-complete-trips: Only complete trips
 * - Idempotency (safe to run multiple times)
 * - Metrics accuracy
 * - Error cases (auth, RBAC, validation)
 */

const request = require('supertest');
const app = require('../../src/app');
const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
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

// Helper to create trip with specific arrival time
async function createTripWithArrival(driverId, vehicleId, arrivalDate, status = 'published') {
  const trip = await TripOfferModel.create({
    driverId,
    vehicleId,
    origin: 'Bogota',
    destination: 'Medellin',
    departureAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
    estimatedArrivalAt: arrivalDate,
    totalSeats: 3,
    pricePerSeat: 50000,
    status
  });
  return trip._id.toString();
}

describe('POST /internal/jobs/run - Lifecycle Jobs', () => {
  let admin, driver, passenger;
  let adminToken, driverToken, passengerToken;
  let csrfToken;
  let vehicleId;

  beforeAll(async () => {
    await connectTestDB();
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
    csrfToken = 'test-csrf-jobs';

    // Create users with specific roles
    admin = await createTestUser('admin', 'admin-jobs@unisabana.edu.co');
    driver = await createTestUser('driver', 'driver-jobs@unisabana.edu.co');
    passenger = await createTestUser('passenger', 'passenger-jobs@unisabana.edu.co');

    // Note: createTestUser might not support 'admin' role, may need to update user manually
    // For now, assuming it works or we'll need to patch it

    adminToken = await loginUser(admin.corporateEmail);
    driverToken = await loginUser(driver.corporateEmail);
    passengerToken = await loginUser(passenger.corporateEmail);

    vehicleId = await createTestVehicle(driver.id, 'JOBS123');
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDB();
  });

  describe('✅ Success Cases - complete-trips (default)', () => {
    test('200 - Auto-complete published trips past arrival + expire old pendings', async () => {
      // Create trips
      const pastTrip1 = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        'published'
      );
      const pastTrip2 = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
        'published'
      );
      const futureTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours future
        'published'
      );

      // Create old pending bookings (created more than 48 hours ago)
      const oldPending1 = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000) // 50 hours ago
      });
      const oldPending2 = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 60 * 60 * 60 * 1000) // 60 hours ago
      });
      const recentPending = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000) // 10 hours ago
      });

      // Run complete-trips job (default)
      const res = await request(app)
        .post('/internal/jobs/run')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      // Verify response
      expect(res.body).toMatchObject({
        ok: true,
        completedTrips: 2,  // 2 past trips
        expiredPendings: 2  // 2 old pendings
      });

      // Verify trips completed
      const trip1 = await TripOfferModel.findById(pastTrip1);
      const trip2 = await TripOfferModel.findById(pastTrip2);
      const trip3 = await TripOfferModel.findById(futureTrip);

      expect(trip1.status).toBe('completed');
      expect(trip2.status).toBe('completed');
      expect(trip3.status).toBe('published'); // Future trip unchanged

      // Verify bookings expired
      const booking1 = await BookingRequestModel.findById(oldPending1._id);
      const booking2 = await BookingRequestModel.findById(oldPending2._id);
      const booking3 = await BookingRequestModel.findById(recentPending._id);

      expect(booking1.status).toBe('expired');
      expect(booking2.status).toBe('expired');
      expect(booking3.status).toBe('pending'); // Recent pending unchanged
    });

    test('200 - Idempotent: Running twice returns zero on second run', async () => {
      const pastTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() - 3 * 60 * 60 * 1000),
        'published'
      );

      // First run
      const res1 = await request(app)
        .post('/internal/jobs/run')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res1.body.completedTrips).toBe(1);

      // Second run (idempotent)
      const res2 = await request(app)
        .post('/internal/jobs/run')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res2.body.completedTrips).toBe(0); // No new completions
    });

    test('200 - No work to do (zero metrics)', async () => {
      // No eligible trips or bookings
      const futureTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() + 5 * 60 * 60 * 1000),
        'published'
      );

      const res = await request(app)
        .post('/internal/jobs/run')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({
        ok: true,
        completedTrips: 0,
        expiredPendings: 0
      });
    });
  });

  describe('✅ Success Cases - auto-complete-trips only', () => {
    test('200 - Only complete trips (no pending expiration)', async () => {
      const pastTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() - 2 * 60 * 60 * 1000),
        'published'
      );

      // Old pending booking (should NOT expire)
      await BookingRequestModel.create({
        tripId: pastTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
      });

      const res = await request(app)
        .post('/internal/jobs/run?name=auto-complete-trips')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({
        ok: true,
        completedTrips: 1,
        expiredPendings: 0  // No expiration
      });

      // Verify trip completed
      const trip = await TripOfferModel.findById(pastTrip);
      expect(trip.status).toBe('completed');

      // Verify pending NOT expired
      const bookings = await BookingRequestModel.find({ tripId: pastTrip });
      expect(bookings[0].status).toBe('pending');
    });
  });

  describe('✅ Success Cases - expire-pendings only', () => {
    test('200 - Only expire old pendings (no trip completion)', async () => {
      const futureTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() + 5 * 60 * 60 * 1000),
        'published'
      );

      // Old pending
      const oldPending = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
      });

      const res = await request(app)
        .post('/internal/jobs/run?name=expire-pendings')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({
        ok: true,
        completedTrips: 0,  // No completions
        expiredPendings: 1
      });

      // Verify trip NOT completed
      const trip = await TripOfferModel.findById(futureTrip);
      expect(trip.status).toBe('published');

      // Verify pending expired
      const booking = await BookingRequestModel.findById(oldPending._id);
      expect(booking.status).toBe('expired');
    });

    test('200 - Custom TTL (expire after 24 hours)', async () => {
      const futureTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() + 5 * 60 * 60 * 1000),
        'published'
      );

      // Create pendings at different ages
      const veryOld = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000) // 50 hours
      });
      const old = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000) // 30 hours
      });
      const recent = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'pending',
        createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000) // 10 hours
      });

      // Expire with 24-hour TTL
      const res = await request(app)
        .post('/internal/jobs/run?name=expire-pendings&pendingTtlHours=24')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body.expiredPendings).toBe(2); // 50h and 30h expired

      const veryOldUpdated = await BookingRequestModel.findById(veryOld._id);
      const oldUpdated = await BookingRequestModel.findById(old._id);
      const recentUpdated = await BookingRequestModel.findById(recent._id);

      expect(veryOldUpdated.status).toBe('expired');
      expect(oldUpdated.status).toBe('expired');
      expect(recentUpdated.status).toBe('pending'); // Within 24h
    });
  });

  describe('❌ Error Cases', () => {
    test('401 - Unauthenticated request', async () => {
      const res = await request(app)
        .post('/internal/jobs/run')
        .expect(401);

      expect(res.body).toHaveProperty('code', 'unauthorized');
    });

    test('403 - Non-admin user (driver)', async () => {
      const res = await request(app)
        .post('/internal/jobs/run')
        .set('Cookie', cookiePair(driverToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(403);

      expect(res.body).toHaveProperty('code', 'forbidden_role');
      expect(res.body.message).toMatch(/admin/i);
    });

    test('403 - Non-admin user (passenger)', async () => {
      const res = await request(app)
        .post('/internal/jobs/run')
        .set('Cookie', cookiePair(passengerToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(403);

      expect(res.body).toHaveProperty('code', 'forbidden_role');
    });

    test('403 - CSRF token missing', async () => {
      const res = await request(app)
        .post('/internal/jobs/run')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        // No X-CSRF-Token header
        .expect(403);

      expect(res.body).toHaveProperty('code', 'csrf_required');
    });

    test('400 - Invalid job name', async () => {
      const res = await request(app)
        .post('/internal/jobs/run?name=invalid-job')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(400);

      expect(res.body).toHaveProperty('code');
      expect(res.body.message).toMatch(/job/i);
    });

    test('400 - Invalid pendingTtlHours (too low)', async () => {
      const res = await request(app)
        .post('/internal/jobs/run?pendingTtlHours=0')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
      expect(res.body.message).toMatch(/pendingTtlHours/i);
    });

    test('400 - Invalid pendingTtlHours (too high)', async () => {
      const res = await request(app)
        .post('/internal/jobs/run?pendingTtlHours=200')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
      expect(res.body.message).toMatch(/pendingTtlHours/i);
    });
  });

  describe('🔒 Security & Data Integrity', () => {
    test('Only published trips are completed (not draft/canceled)', async () => {
      const draftTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() - 2 * 60 * 60 * 1000),
        'draft'
      );
      const canceledTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() - 2 * 60 * 60 * 1000),
        'canceled'
      );
      const completedTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() - 2 * 60 * 60 * 1000),
        'completed'
      );

      const res = await request(app)
        .post('/internal/jobs/run?name=auto-complete-trips')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body.completedTrips).toBe(0); // None completed

      // Verify states unchanged
      const draft = await TripOfferModel.findById(draftTrip);
      const canceled = await TripOfferModel.findById(canceledTrip);
      const completed = await TripOfferModel.findById(completedTrip);

      expect(draft.status).toBe('draft');
      expect(canceled.status).toBe('canceled');
      expect(completed.status).toBe('completed');
    });

    test('Only pending bookings are expired (not accepted/declined)', async () => {
      const futureTrip = await createTripWithArrival(
        driver.id,
        vehicleId,
        new Date(Date.now() + 5 * 60 * 60 * 1000),
        'published'
      );

      // Old bookings in different states
      const oldAccepted = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'accepted',
        createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
      });
      const oldDeclined = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'declined',
        createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
      });
      const oldCanceled = await BookingRequestModel.create({
        tripId: futureTrip,
        passengerId: passenger.id,
        seats: 1,
        status: 'canceled_by_passenger',
        createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
      });

      const res = await request(app)
        .post('/internal/jobs/run?name=expire-pendings')
        .set('Cookie', cookiePair(adminToken, csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body.expiredPendings).toBe(0); // None expired

      // Verify states unchanged
      const accepted = await BookingRequestModel.findById(oldAccepted._id);
      const declined = await BookingRequestModel.findById(oldDeclined._id);
      const canceled = await BookingRequestModel.findById(oldCanceled._id);

      expect(accepted.status).toBe('accepted');
      expect(declined.status).toBe('declined');
      expect(canceled.status).toBe('canceled_by_passenger');
    });

    test('No PII in error responses', async () => {
      const res = await request(app)
        .post('/internal/jobs/run')
        // No auth
        .expect(401);

      expect(res.body).toHaveProperty('correlationId');

      const responseBody = JSON.stringify(res.body);
      expect(responseBody).not.toMatch(/@unisabana\.edu\.co/);
    });
  });
});
