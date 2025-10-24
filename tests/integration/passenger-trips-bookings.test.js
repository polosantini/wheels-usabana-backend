/**
 * Integration Tests: Passenger Trip Search and Booking Management
 * Subtask 3.2.6 - OpenAPI and Tests (Passenger Search and Booking)
 *
 * Test Coverage:
 * - GET /passengers/trips/search (filters, pagination, published+future enforcement)
 * - POST /passengers/bookings (happy path, duplicate, invalid trip state)
 * - GET /passengers/bookings (filters, pagination)
 * - DELETE /passengers/bookings/:bookingId (owner-only, idempotent)
 * - Security: No PII leaks, structured logs
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const UserModel = require('../../src/infrastructure/database/models/UserModel');
const VehicleModel = require('../../src/infrastructure/database/models/VehicleModel');
const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');
const { generateToken } = require('../../src/utils/jwt');

describe('Passenger Trip Search and Booking - Complete Integration Tests (Subtask 3.2.6)', () => {
  let passengerUser;
  let passengerToken;
  let passengerCookie;

  let driverUser;
  let driverToken;
  let driverCookie;

  let testVehicle;
  let publishedTrip;
  let draftTrip;
  let canceledTrip;
  let pastTrip;

  beforeAll(async () => {
    // Clean up test data
    await UserModel.deleteMany({ corporateEmail: /triptest@unisabana\.edu\.co/ });
    await VehicleModel.deleteMany({});
    await TripOfferModel.deleteMany({});
    await BookingRequestModel.deleteMany({});

    // Create test passenger
    passengerUser = await UserModel.create({
      fullName: 'Trip Test Passenger',
      corporateEmail: 'triptest.passenger@unisabana.edu.co',
      password: '$2b$10$abcdefghijklmnopqrstuv', // Hashed password
      role: 'passenger',
      isEmailVerified: true
    });
    passengerToken = generateToken({ userId: passengerUser._id.toString(), role: 'passenger' });
    passengerCookie = `access_token=${passengerToken}`;

    // Create test driver
    driverUser = await UserModel.create({
      fullName: 'Trip Test Driver',
      corporateEmail: 'triptest.driver@unisabana.edu.co',
      password: '$2b$10$abcdefghijklmnopqrstuv',
      role: 'driver',
      isEmailVerified: true
    });
    driverToken = generateToken({ userId: driverUser._id.toString(), role: 'driver' });
    driverCookie = `access_token=${driverToken}`;

    // Create test vehicle
    testVehicle = await VehicleModel.create({
      ownerId: driverUser._id,
      brand: 'Toyota',
      model: 'Corolla',
      year: 2022,
      color: 'White',
      plate: 'ABC123',
      capacity: 4
    });

    // Create test trips with different statuses and dates
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Published trip (future, searchable)
    publishedTrip = await TripOfferModel.create({
      driverId: driverUser._id,
      vehicleId: testVehicle._id,
      origin: {
        text: 'Universidad de La Sabana',
        geo: { lat: 4.8611, lng: -74.0315 }
      },
      destination: {
        text: 'Centro Comercial Andino',
        geo: { lat: 4.6706, lng: -74.0554 }
      },
      departureAt: tomorrow,
      estimatedArrivalAt: new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000),
      pricePerSeat: 15000,
      totalSeats: 3,
      status: 'published',
      notes: 'Trip to Andino Mall'
    });

    // Draft trip (not searchable)
    draftTrip = await TripOfferModel.create({
      driverId: driverUser._id,
      vehicleId: testVehicle._id,
      origin: {
        text: 'Universidad de La Sabana',
        geo: { lat: 4.8611, lng: -74.0315 }
      },
      destination: {
        text: 'Unicentro',
        geo: { lat: 4.6973, lng: -74.0478 }
      },
      departureAt: nextWeek,
      estimatedArrivalAt: new Date(nextWeek.getTime() + 2 * 60 * 60 * 1000),
      pricePerSeat: 12000,
      totalSeats: 3,
      status: 'draft',
      notes: 'Draft trip'
    });

    // Canceled trip (not searchable)
    canceledTrip = await TripOfferModel.create({
      driverId: driverUser._id,
      vehicleId: testVehicle._id,
      origin: {
        text: 'Universidad de La Sabana',
        geo: { lat: 4.8611, lng: -74.0315 }
      },
      destination: {
        text: 'Parque 93',
        geo: { lat: 4.6764, lng: -74.0469 }
      },
      departureAt: nextWeek,
      estimatedArrivalAt: new Date(nextWeek.getTime() + 2 * 60 * 60 * 1000),
      pricePerSeat: 18000,
      totalSeats: 3,
      status: 'canceled',
      notes: 'Canceled trip'
    });

    // Past trip (not searchable - future enforcement)
    pastTrip = await TripOfferModel.create({
      driverId: driverUser._id,
      vehicleId: testVehicle._id,
      origin: {
        text: 'Universidad de La Sabana',
        geo: { lat: 4.8611, lng: -74.0315 }
      },
      destination: {
        text: 'Aeropuerto El Dorado',
        geo: { lat: 4.7016, lng: -74.1469 }
      },
      departureAt: lastWeek,
      estimatedArrivalAt: yesterday,
      pricePerSeat: 25000,
      totalSeats: 3,
      status: 'published',
      notes: 'Past trip'
    });
  });

  afterAll(async () => {
    // Clean up
    await UserModel.deleteMany({ corporateEmail: /triptest@unisabana\.edu\.co/ });
    await VehicleModel.deleteMany({ plate: 'ABC123' });
    await TripOfferModel.deleteMany({ driverId: driverUser._id });
    await BookingRequestModel.deleteMany({ passengerId: passengerUser._id });
    await mongoose.connection.close();
  });

  // ============================================================
  // GET /passengers/trips/search
  // ============================================================

  describe('GET /passengers/trips/search', () => {
    describe('Happy Path - Search Filters', () => {
      it('should return only published future trips (status enforcement)', async () => {
        const res = await request(app)
          .get('/passengers/trips/search')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toHaveProperty('trips');
        expect(Array.isArray(res.body.trips)).toBe(true);

        // Should include published trip
        const tripIds = res.body.trips.map(t => t.id);
        expect(tripIds).toContain(publishedTrip._id.toString());

        // Should NOT include draft, canceled, or past trips
        expect(tripIds).not.toContain(draftTrip._id.toString());
        expect(tripIds).not.toContain(canceledTrip._id.toString());
        expect(tripIds).not.toContain(pastTrip._id.toString());

        // Verify all trips are published and in the future
        res.body.trips.forEach(trip => {
          expect(trip.status).toBe('published');
          expect(new Date(trip.departureAt).getTime()).toBeGreaterThan(Date.now());
        });
      });

      it('should filter by origin text (qOrigin)', async () => {
        const res = await request(app)
          .get('/passengers/trips/search?qOrigin=Sabana')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body.trips.length).toBeGreaterThan(0);
        res.body.trips.forEach(trip => {
          expect(trip.origin.text.toLowerCase()).toContain('sabana');
        });
      });

      it('should filter by destination text (qDestination)', async () => {
        const res = await request(app)
          .get('/passengers/trips/search?qDestination=Andino')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body.trips.length).toBeGreaterThan(0);
        res.body.trips.forEach(trip => {
          expect(trip.destination.text.toLowerCase()).toContain('andino');
        });
      });

      it('should filter by date range (fromDate, toDate)', async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const res = await request(app)
          .get(`/passengers/trips/search?fromDate=${tomorrow.toISOString().split('T')[0]}&toDate=${nextWeek.toISOString().split('T')[0]}`)
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toHaveProperty('trips');
        res.body.trips.forEach(trip => {
          const departureDate = new Date(trip.departureAt);
          expect(departureDate.getTime()).toBeGreaterThanOrEqual(tomorrow.getTime());
          expect(departureDate.getTime()).toBeLessThanOrEqual(nextWeek.getTime());
        });
      });

      it('should support pagination (page, pageSize)', async () => {
        const res = await request(app)
          .get('/passengers/trips/search?page=1&pageSize=5')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toHaveProperty('trips');
        expect(res.body).toHaveProperty('pagination');
        expect(res.body.pagination).toHaveProperty('page', 1);
        expect(res.body.pagination).toHaveProperty('pageSize', 5);
        expect(res.body.pagination).toHaveProperty('total');
        expect(res.body.pagination).toHaveProperty('totalPages');
        expect(res.body.trips.length).toBeLessThanOrEqual(5);
      });

      it('should return empty array when no trips match filters', async () => {
        const res = await request(app)
          .get('/passengers/trips/search?qDestination=NonExistentPlace12345')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body.trips).toEqual([]);
        expect(res.body.pagination.total).toBe(0);
      });
    });

    describe('Validation Errors (400)', () => {
      it('should return 400 for invalid page (< 1)', async () => {
        const res = await request(app)
          .get('/passengers/trips/search?page=0')
          .set('Cookie', passengerCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for invalid pageSize (> 50)', async () => {
        const res = await request(app)
          .get('/passengers/trips/search?pageSize=100')
          .set('Cookie', passengerCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for invalid date format', async () => {
        const res = await request(app)
          .get('/passengers/trips/search?fromDate=invalid-date')
          .set('Cookie', passengerCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('Authentication (401)', () => {
      it('should return 401 without authentication', async () => {
        const res = await request(app)
          .get('/passengers/trips/search')
          .expect(401);

        expect(res.body).toHaveProperty('code', 'unauthorized');
      });

      it('should return 401 with invalid token', async () => {
        const res = await request(app)
          .get('/passengers/trips/search')
          .set('Cookie', 'access_token=invalid_token')
          .expect(401);

        expect(res.body).toHaveProperty('code', 'unauthorized');
      });
    });

    describe('Security - No PII Leaks', () => {
      it('should not expose driver PII in search results', async () => {
        const res = await request(app)
          .get('/passengers/trips/search')
          .set('Cookie', passengerCookie)
          .expect(200);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain(driverUser.corporateEmail);
        expect(responseText).not.toContain(driverUser.password);

        // Should include driverId but not full driver details
        res.body.trips.forEach(trip => {
          expect(trip).toHaveProperty('driverId');
          expect(trip).not.toHaveProperty('driver.corporateEmail');
          expect(trip).not.toHaveProperty('driver.password');
        });
      });
    });
  });

  // ============================================================
  // POST /passengers/bookings
  // ============================================================

  describe('POST /passengers/bookings', () => {
    beforeEach(async () => {
      // Clean up bookings before each test
      await BookingRequestModel.deleteMany({ passengerId: passengerUser._id });
    });

    describe('Happy Path - Create Booking Request', () => {
      it('should create booking request with valid tripId', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: publishedTrip._id.toString() })
          .expect(201);

        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('passengerId', passengerUser._id.toString());
        expect(res.body).toHaveProperty('tripId', publishedTrip._id.toString());
        expect(res.body).toHaveProperty('status', 'pending');
        expect(res.body).toHaveProperty('createdAt');
        expect(res.body).not.toHaveProperty('note'); // Empty note should not appear

        // Verify booking was created in database
        const booking = await BookingRequestModel.findById(res.body.id);
        expect(booking).not.toBeNull();
        expect(booking.passengerId.toString()).toBe(passengerUser._id.toString());
        expect(booking.tripId.toString()).toBe(publishedTrip._id.toString());
      });

      it('should create booking request with note', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({
            tripId: publishedTrip._id.toString(),
            note: 'I will bring a small suitcase'
          })
          .expect(201);

        expect(res.body).toHaveProperty('note', 'I will bring a small suitcase');
      });

      it('should return 201 with booking details matching schema', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: publishedTrip._id.toString() })
          .expect(201);

        // Verify schema structure
        expect(res.body).toMatchObject({
          id: expect.any(String),
          passengerId: expect.any(String),
          tripId: expect.any(String),
          status: 'pending',
          createdAt: expect.any(String)
        });
      });
    });

    describe('Duplicate Request (409)', () => {
      it('should return 409 for duplicate booking request (same passenger, same trip)', async () => {
        const tripId = publishedTrip._id.toString();

        // First request - should succeed
        await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId })
          .expect(201);

        // Second request - should fail with 409
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'duplicate_request');
        expect(res.body).toHaveProperty('message');
        expect(res.body).toHaveProperty('correlationId');
      });

      it('should allow rebooking after canceling previous request', async () => {
        const tripId = publishedTrip._id.toString();

        // Create booking
        const createRes = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId })
          .expect(201);

        const bookingId = createRes.body.id;

        // Cancel booking
        await request(app)
          .delete(`/passengers/bookings/${bookingId}`)
          .set('Cookie', passengerCookie)
          .expect(200);

        // Rebook - should succeed
        const rebookRes = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId })
          .expect(201);

        expect(rebookRes.body).toHaveProperty('id');
        expect(rebookRes.body.id).not.toBe(bookingId); // New booking ID
      });
    });

    describe('Invalid Trip State (409)', () => {
      it('should return 409 for booking draft trip', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: draftTrip._id.toString() })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_trip_state');
        expect(res.body.message).toContain('draft');
      });

      it('should return 409 for booking canceled trip', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: canceledTrip._id.toString() })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_trip_state');
        expect(res.body.message).toContain('canceled');
      });

      it('should return 409 for booking past trip', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: pastTrip._id.toString() })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'trip_in_past');
      });

      it('should return 409 when trip is full (no available seats)', async () => {
        // Create a trip with 1 seat
        const fullTrip = await TripOfferModel.create({
          driverId: driverUser._id,
          vehicleId: testVehicle._id,
          origin: { text: 'Origin', geo: { lat: 4.8611, lng: -74.0315 } },
          destination: { text: 'Destination', geo: { lat: 4.6706, lng: -74.0554 } },
          departureAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          estimatedArrivalAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
          pricePerSeat: 10000,
          totalSeats: 1,
          status: 'published'
        });

        // Create another passenger to fill the seat
        const otherPassenger = await UserModel.create({
          fullName: 'Other Passenger',
          corporateEmail: 'triptest.other@unisabana.edu.co',
          password: '$2b$10$abcdefghijklmnopqrstuv',
          role: 'passenger',
          isEmailVerified: true
        });
        const otherToken = generateToken({ userId: otherPassenger._id.toString(), role: 'passenger' });

        // First passenger books the only seat
        await request(app)
          .post('/passengers/bookings')
          .set('Cookie', `access_token=${otherToken}`)
          .send({ tripId: fullTrip._id.toString() })
          .expect(201);

        // Second passenger tries to book - should fail
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: fullTrip._id.toString() })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'no_seats_available');

        // Cleanup
        await UserModel.deleteOne({ _id: otherPassenger._id });
        await TripOfferModel.deleteOne({ _id: fullTrip._id });
      });
    });

    describe('Validation Errors (400)', () => {
      it('should return 400 for missing tripId', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({})
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for invalid tripId format', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: 'invalid-id' })
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for note exceeding 300 characters', async () => {
        const longNote = 'a'.repeat(301);

        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({
            tripId: publishedTrip._id.toString(),
            note: longNote
          })
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 404 for non-existent tripId', async () => {
        const nonExistentId = new mongoose.Types.ObjectId().toString();

        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: nonExistentId })
          .expect(404);

        expect(res.body).toHaveProperty('code', 'trip_not_found');
      });
    });

    describe('Role Validation (403)', () => {
      it('should return 403 when driver tries to book a trip', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', driverCookie)
          .send({ tripId: publishedTrip._id.toString() })
          .expect(403);

        expect(res.body).toHaveProperty('code', 'forbidden_role');
        expect(res.body.message).toContain('passenger');
      });

      it('should prevent driver from booking their own trip', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', driverCookie)
          .send({ tripId: publishedTrip._id.toString() })
          .expect(403);

        expect(res.body).toHaveProperty('code', 'forbidden_role');
      });
    });

    describe('Authentication (401)', () => {
      it('should return 401 without authentication', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .send({ tripId: publishedTrip._id.toString() })
          .expect(401);

        expect(res.body).toHaveProperty('code', 'unauthorized');
      });
    });

    describe('Security - No PII Leaks', () => {
      it('should not expose sensitive data in booking response', async () => {
        const res = await request(app)
          .post('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .send({ tripId: publishedTrip._id.toString() })
          .expect(201);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain(passengerUser.corporateEmail);
        expect(responseText).not.toContain(driverUser.corporateEmail);
        expect(responseText).not.toContain('password');
      });
    });
  });

  // ============================================================
  // GET /passengers/bookings
  // ============================================================

  describe('GET /passengers/bookings', () => {
    let pendingBooking;
    let canceledBooking;

    beforeAll(async () => {
      // Clean up
      await BookingRequestModel.deleteMany({ passengerId: passengerUser._id });

      // Create test bookings
      pendingBooking = await BookingRequestModel.create({
        passengerId: passengerUser._id,
        tripId: publishedTrip._id,
        status: 'pending',
        note: 'Pending booking'
      });

      canceledBooking = await BookingRequestModel.create({
        passengerId: passengerUser._id,
        tripId: publishedTrip._id,
        status: 'canceled_by_passenger',
        note: 'Canceled booking'
      });
    });

    describe('Happy Path - List My Bookings', () => {
      it('should return all my bookings', async () => {
        const res = await request(app)
          .get('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toHaveProperty('bookings');
        expect(Array.isArray(res.body.bookings)).toBe(true);
        expect(res.body.bookings.length).toBeGreaterThanOrEqual(2);

        // Verify all bookings belong to the passenger
        res.body.bookings.forEach(booking => {
          expect(booking.passengerId).toBe(passengerUser._id.toString());
        });
      });

      it('should filter by status (pending)', async () => {
        const res = await request(app)
          .get('/passengers/bookings?status=pending')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body.bookings.length).toBeGreaterThan(0);
        res.body.bookings.forEach(booking => {
          expect(booking.status).toBe('pending');
        });
      });

      it('should filter by status (canceled_by_passenger)', async () => {
        const res = await request(app)
          .get('/passengers/bookings?status=canceled_by_passenger')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body.bookings.length).toBeGreaterThan(0);
        res.body.bookings.forEach(booking => {
          expect(booking.status).toBe('canceled_by_passenger');
        });
      });

      it('should filter by multiple statuses', async () => {
        const res = await request(app)
          .get('/passengers/bookings?status=pending&status=canceled_by_passenger')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body.bookings.length).toBeGreaterThanOrEqual(2);
        res.body.bookings.forEach(booking => {
          expect(['pending', 'canceled_by_passenger']).toContain(booking.status);
        });
      });

      it('should support pagination', async () => {
        const res = await request(app)
          .get('/passengers/bookings?page=1&pageSize=1')
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toHaveProperty('pagination');
        expect(res.body.pagination).toHaveProperty('page', 1);
        expect(res.body.pagination).toHaveProperty('pageSize', 1);
        expect(res.body.pagination).toHaveProperty('total');
        expect(res.body.bookings.length).toBeLessThanOrEqual(1);
      });

      it('should return empty array when no bookings match filters', async () => {
        // Create a new passenger with no bookings
        const newPassenger = await UserModel.create({
          fullName: 'New Passenger',
          corporateEmail: 'triptest.new@unisabana.edu.co',
          password: '$2b$10$abcdefghijklmnopqrstuv',
          role: 'passenger',
          isEmailVerified: true
        });
        const newToken = generateToken({ userId: newPassenger._id.toString(), role: 'passenger' });

        const res = await request(app)
          .get('/passengers/bookings')
          .set('Cookie', `access_token=${newToken}`)
          .expect(200);

        expect(res.body.bookings).toEqual([]);
        expect(res.body.pagination.total).toBe(0);

        // Cleanup
        await UserModel.deleteOne({ _id: newPassenger._id });
      });
    });

    describe('Validation Errors (400)', () => {
      it('should return 400 for invalid page', async () => {
        const res = await request(app)
          .get('/passengers/bookings?page=0')
          .set('Cookie', passengerCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for invalid pageSize (> 50)', async () => {
        const res = await request(app)
          .get('/passengers/bookings?pageSize=100')
          .set('Cookie', passengerCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for invalid status value', async () => {
        const res = await request(app)
          .get('/passengers/bookings?status=invalid_status')
          .set('Cookie', passengerCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('Authentication (401)', () => {
      it('should return 401 without authentication', async () => {
        const res = await request(app)
          .get('/passengers/bookings')
          .expect(401);

        expect(res.body).toHaveProperty('code', 'unauthorized');
      });
    });

    describe('Security - No PII Leaks', () => {
      it('should not expose sensitive passenger data', async () => {
        const res = await request(app)
          .get('/passengers/bookings')
          .set('Cookie', passengerCookie)
          .expect(200);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain(passengerUser.corporateEmail);
        expect(responseText).not.toContain('password');
      });
    });
  });

  // ============================================================
  // DELETE /passengers/bookings/:bookingId
  // ============================================================

  describe('DELETE /passengers/bookings/:bookingId', () => {
    let testBooking;

    beforeEach(async () => {
      // Create a fresh booking for each test
      testBooking = await BookingRequestModel.create({
        passengerId: passengerUser._id,
        tripId: publishedTrip._id,
        status: 'pending',
        note: 'Test booking for cancellation'
      });
    });

    describe('Happy Path - Cancel Booking', () => {
      it('should cancel booking (owner-only)', async () => {
        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toHaveProperty('id', testBooking._id.toString());
        expect(res.body).toHaveProperty('status', 'canceled_by_passenger');

        // Verify booking was canceled in database
        const updatedBooking = await BookingRequestModel.findById(testBooking._id);
        expect(updatedBooking.status).toBe('canceled_by_passenger');
      });

      it('should be idempotent (cancel already canceled booking)', async () => {
        // First cancellation
        await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', passengerCookie)
          .expect(200);

        // Second cancellation - should still return 200
        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toHaveProperty('status', 'canceled_by_passenger');
      });

      it('should return booking details on cancellation', async () => {
        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', passengerCookie)
          .expect(200);

        expect(res.body).toMatchObject({
          id: expect.any(String),
          passengerId: passengerUser._id.toString(),
          tripId: publishedTrip._id.toString(),
          status: 'canceled_by_passenger'
        });
      });
    });

    describe('Ownership Validation (403)', () => {
      it('should return 403 when non-owner tries to cancel booking', async () => {
        // Create another passenger
        const otherPassenger = await UserModel.create({
          fullName: 'Other Passenger',
          corporateEmail: 'triptest.other2@unisabana.edu.co',
          password: '$2b$10$abcdefghijklmnopqrstuv',
          role: 'passenger',
          isEmailVerified: true
        });
        const otherToken = generateToken({ userId: otherPassenger._id.toString(), role: 'passenger' });

        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', `access_token=${otherToken}`)
          .expect(403);

        expect(res.body).toHaveProperty('code', 'forbidden_owner');
        expect(res.body.message).toContain('own');

        // Verify booking was NOT canceled
        const booking = await BookingRequestModel.findById(testBooking._id);
        expect(booking.status).toBe('pending');

        // Cleanup
        await UserModel.deleteOne({ _id: otherPassenger._id });
      });

      it('should return 403 when driver tries to cancel passenger booking', async () => {
        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', driverCookie)
          .expect(403);

        expect(res.body).toHaveProperty('code', 'forbidden_owner');
      });
    });

    describe('Not Found (404)', () => {
      it('should return 404 for non-existent bookingId', async () => {
        const nonExistentId = new mongoose.Types.ObjectId().toString();

        const res = await request(app)
          .delete(`/passengers/bookings/${nonExistentId}`)
          .set('Cookie', passengerCookie)
          .expect(404);

        expect(res.body).toHaveProperty('code', 'booking_not_found');
      });

      it('should return 400 for invalid bookingId format', async () => {
        const res = await request(app)
          .delete('/passengers/bookings/invalid-id')
          .set('Cookie', passengerCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('Invalid State (409)', () => {
      it('should return 409 when canceling approved booking', async () => {
        // Update booking to approved status
        await BookingRequestModel.findByIdAndUpdate(testBooking._id, { status: 'approved' });

        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', passengerCookie)
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_state');
        expect(res.body.message).toContain('approved');
      });

      it('should return 409 when canceling rejected booking', async () => {
        // Update booking to rejected status
        await BookingRequestModel.findByIdAndUpdate(testBooking._id, { status: 'rejected' });

        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', passengerCookie)
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_state');
        expect(res.body.message).toContain('rejected');
      });
    });

    describe('Authentication (401)', () => {
      it('should return 401 without authentication', async () => {
        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .expect(401);

        expect(res.body).toHaveProperty('code', 'unauthorized');
      });
    });

    describe('Security - No PII Leaks', () => {
      it('should not expose sensitive data in cancellation response', async () => {
        const res = await request(app)
          .delete(`/passengers/bookings/${testBooking._id.toString()}`)
          .set('Cookie', passengerCookie)
          .expect(200);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain(passengerUser.corporateEmail);
        expect(responseText).not.toContain('password');
      });
    });
  });

  // ============================================================
  // Structured Logging
  // ============================================================

  describe('Structured Logging', () => {
    it('should log search queries without PII', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await request(app)
        .get('/passengers/trips/search?qOrigin=Sabana')
        .set('Cookie', passengerCookie)
        .expect(200);

      const allLogs = consoleLogSpy.mock.calls.map(call => call.join(' '));
      consoleLogSpy.mockRestore();

      // Should log search action
      const searchLogs = allLogs.filter(log => log.includes('search'));
      expect(searchLogs.length).toBeGreaterThan(0);

      // Should NOT log sensitive data
      allLogs.forEach(log => {
        expect(log).not.toContain(passengerUser.corporateEmail);
        expect(log).not.toContain('password');
      });
    });

    it('should log booking creation without PII', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await BookingRequestModel.deleteMany({ passengerId: passengerUser._id, tripId: publishedTrip._id });

      await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerCookie)
        .send({ tripId: publishedTrip._id.toString() })
        .expect(201);

      const allLogs = consoleLogSpy.mock.calls.map(call => call.join(' '));
      consoleLogSpy.mockRestore();

      // Should log booking action
      const bookingLogs = allLogs.filter(log => log.includes('booking') || log.includes('Booking'));
      expect(bookingLogs.length).toBeGreaterThan(0);

      // Should NOT log sensitive data
      allLogs.forEach(log => {
        expect(log).not.toContain(passengerUser.corporateEmail);
        expect(log).not.toContain('password');
      });
    });
  });
});
