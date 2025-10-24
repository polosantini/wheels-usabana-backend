/**
 * Integration Tests for Passenger Search and Booking (Subtask 3.2.6)
 * 
 * Covers:
 * - GET /passengers/trips/search (filters, pagination, published+future only)
 * - POST /passengers/bookings (happy, duplicate, invalid trip state)
 * - GET /passengers/bookings (filter/paginate)
 * - DELETE /passengers/bookings/:bookingId (owner-only, idempotent)
 * 
 * Ensures no PII leaks and structured logs.
 */

require('dotenv').config();
const request = require('supertest');
const app = require('../../src/app');
const connectDB = require('../../src/infrastructure/database/connection');
const UserModel = require('../../src/infrastructure/database/models/UserModel');
const VehicleModel = require('../../src/infrastructure/database/models/VehicleModel');
const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');
const bcrypt = require('bcrypt');

describe('Passenger Search and Booking Integration Tests', () => {
  let driver, passenger1, passenger2, vehicle;
  let passengerToken1, passengerToken2, csrfToken1, csrfToken2;

  // Helper to create a trip safely (dates set at creation time to avoid timing issues)
  async function createTrip(status, daysInFuture = 3) {
    const departureAt = new Date(Date.now() + daysInFuture * 24 * 60 * 60 * 1000);
    const estimatedArrivalAt = new Date(departureAt.getTime() + 60 * 60 * 1000);
    
    return await TripOfferModel.create({
      driverId: driver._id,
      vehicleId: vehicle._id,
      origin: { text: 'Campus Norte', geo: { lat: 4.7, lng: -74.0 } },
      destination: { text: 'Centro Bogotá', geo: { lat: 4.6, lng: -74.1 } },
      departureAt,
      estimatedArrivalAt,
      pricePerSeat: 5000,
      totalSeats: 3,
      status,
      notes: `Trip with status ${status}`
    });
  }

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    // Final cleanup
    await Promise.all([
      UserModel.deleteMany({ corporateEmail: { $regex: /passengerbookingtest.*@unisabana\.edu\.co/i } }),
      VehicleModel.deleteMany({ plate: { $regex: /^PBT/ } }),
      TripOfferModel.deleteMany({ notes: { $regex: /Trip with status/ } }),
      BookingRequestModel.deleteMany({})
    ]);
    await require('mongoose').connection.close();
  });

  afterEach(async () => {
    // Cleanup after each test
    await Promise.all([
      BookingRequestModel.deleteMany({}),
      TripOfferModel.deleteMany({ notes: { $regex: /Trip with status/ } })
    ]);
  });

  beforeEach(async () => {
    // Cleanup - delete test data only (wait for completion)
    await Promise.all([
      UserModel.deleteMany({ corporateEmail: { $regex: /passengerbookingtest.*@unisabana\.edu\.co/i } }),
      VehicleModel.deleteMany({ plate: { $regex: /^PBT/ } }),
      TripOfferModel.deleteMany({ notes: { $regex: /Trip with status/ } }),
      BookingRequestModel.deleteMany({})
    ]);

    // Small delay to ensure database cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Create test users
    const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

    // Generate unique IDs for this test run
    const uniqueId = Date.now().toString().slice(-6);
    
    driver = await UserModel.create({
      role: 'driver',
      firstName: 'PassengerBookingTest',
      lastName: 'Driver',
      universityId: `9991${uniqueId}00`,
      corporateEmail: 'passengerbookingtest-driver@unisabana.edu.co',
      phone: '+573001111111',
      password: hashedPassword
    });

    passenger1 = await UserModel.create({
      role: 'passenger',
      firstName: 'PassengerBookingTest',
      lastName: 'Passenger1',
      universityId: `9991${uniqueId}01`,
      corporateEmail: 'passengerbookingtest-passenger1@unisabana.edu.co',
      phone: '+573002222222',
      password: hashedPassword
    });

    passenger2 = await UserModel.create({
      role: 'passenger',
      firstName: 'PassengerBookingTest',
      lastName: 'Passenger2',
      universityId: `9991${uniqueId}02`,
      corporateEmail: 'passengerbookingtest-passenger2@unisabana.edu.co',
      phone: '+573003333333',
      password: hashedPassword
    });

    // Login passengers
    const login1 = await request(app)
      .post('/auth/login')
      .send({
        corporateEmail: passenger1.corporateEmail,
        password: 'TestPassword123!'
      })
      .expect(200);

    const cookies1 = login1.headers['set-cookie'];
    const accessToken1 = cookies1.find(c => c.startsWith('access_token=')).split(';')[0];
    const csrfCookie1 = cookies1.find(c => c.startsWith('csrf_token=')).split(';')[0];
    csrfToken1 = csrfCookie1.split('=')[1];
    passengerToken1 = `${accessToken1}; ${csrfCookie1}`;

    const login2 = await request(app)
      .post('/auth/login')
      .send({
        corporateEmail: passenger2.corporateEmail,
        password: 'TestPassword123!'
      })
      .expect(200);

    const cookies2 = login2.headers['set-cookie'];
    const accessToken2 = cookies2.find(c => c.startsWith('access_token=')).split(';')[0];
    const csrfCookie2 = cookies2.find(c => c.startsWith('csrf_token=')).split(';')[0];
    csrfToken2 = csrfCookie2.split('=')[1];
    passengerToken2 = `${accessToken2}; ${csrfCookie2}`;

    // Create vehicle
    vehicle = await VehicleModel.create({
      driverId: driver._id,
      plate: 'PBT100',
      brand: 'Toyota',
      model: 'Corolla',
      color: 'White',
      capacity: 4,
      vehiclePhotoUrl: '/uploads/vehicles/test.jpg',
      soatPhotoUrl: '/uploads/vehicles/soat.pdf'
    });
  });

  describe('GET /passengers/trips/search', () => {
    it('should return only published future trips', async () => {
      // Create trips right before the test
      const publishedTrip = await createTrip('published', 3);
      await createTrip('draft', 4); // Should not appear
      
      const res = await request(app)
        .get('/passengers/trips/search')
        .set('Cookie', passengerToken1)
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('total');

      // Should only include publishedTrip (not draft)
      expect(res.body.items.length).toBe(1);
      expect(res.body.items[0].id).toBe(publishedTrip._id.toString());
      expect(res.body.items[0].status).toBe('published');
    });

    it('should filter by qOrigin text', async () => {
      await createTrip('published', 3);

      const res = await request(app)
        .get('/passengers/trips/search')
        .query({ qOrigin: 'Campus Norte' })
        .set('Cookie', passengerToken1)
        .expect(200);

      expect(res.body.items.length).toBe(1);
      expect(res.body.items[0].origin.text).toContain('Campus Norte');
    });

    it('should filter by qDestination text', async () => {
      await createTrip('published', 3);

      const res = await request(app)
        .get('/passengers/trips/search')
        .query({ qDestination: 'Bogotá' })
        .set('Cookie', passengerToken1)
        .expect(200);

      expect(res.body.items.length).toBe(1);
      expect(res.body.items[0].destination.text).toContain('Bogotá');
    });

    it('should handle pagination', async () => {
      // Create multiple trips
      for (let i = 0; i < 5; i++) {
        await createTrip('published', 3 + i);
      }

      const res = await request(app)
        .get('/passengers/trips/search')
        .query({ page: 1, pageSize: 3 })
        .set('Cookie', passengerToken1)
        .expect(200);

      expect(res.body.items.length).toBe(3);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(3);
      expect(res.body.total).toBe(5);
      expect(res.body.totalPages).toBe(2);
    });

    it('should enforce max pageSize of 50', async () => {
      await request(app)
        .get('/passengers/trips/search')
        .query({ pageSize: 100 })
        .set('Cookie', passengerToken1)
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/passengers/trips/search')
        .expect(401);
    });

    it('should not expose driver PII', async () => {
      await createTrip('published', 3);

      const res = await request(app)
        .get('/passengers/trips/search')
        .set('Cookie', passengerToken1)
        .expect(200);

      const trip = res.body.items[0];
      
      // Should have driverId but not driver's email, phone, etc.
      expect(trip).toHaveProperty('driverId');
      expect(trip).not.toHaveProperty('corporateEmail');
      expect(trip).not.toHaveProperty('phone');
      expect(trip).not.toHaveProperty('password');
    });
  });

  describe('POST /passengers/bookings', () => {
    let publishedTrip, draftTrip;

    beforeEach(async () => {
      publishedTrip = await createTrip('published', 3);
      draftTrip = await createTrip('draft', 4);
    });

    it('should create a booking request (happy path)', async () => {
      const res = await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .send({
          tripId: publishedTrip._id.toString(),
          note: 'I have a small backpack'
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.tripId).toBe(publishedTrip._id.toString());
      expect(res.body.passengerId).toBe(passenger1._id.toString());
      expect(res.body.status).toBe('pending');
      expect(res.body.note).toBe('I have a small backpack');
    });

    it('should reject duplicate request for same trip (409)', async () => {
      // First request succeeds
      await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .send({ tripId: publishedTrip._id.toString() })
        .expect(201);

      // Second request fails
      const res = await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .send({ tripId: publishedTrip._id.toString() })
        .expect(409);

      expect(res.body.code).toBe('duplicate_request');
    });

    it('should reject booking for draft trip (409)', async () => {
      const res = await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .send({ tripId: draftTrip._id.toString() })
        .expect(409);

      expect(res.body.code).toBe('invalid_trip_state');
    });

    it('should reject booking for non-existent trip (404)', async () => {
      await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .send({ tripId: '507f1f77bcf86cd799439011' })
        .expect(404);
    });

    it('should validate note length (max 300 chars)', async () => {
      const longNote = 'a'.repeat(301);
      
      await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .send({
          tripId: publishedTrip._id.toString(),
          note: longNote
        })
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/passengers/bookings')
        .send({ tripId: publishedTrip._id.toString() })
        .expect(401);
    });

    it('should require CSRF token', async () => {
      await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .send({ tripId: publishedTrip._id.toString() })
        .expect(403);
    });

    it('should allow different passengers to book the same trip', async () => {
      // Passenger 1 books
      await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .send({ tripId: publishedTrip._id.toString() })
        .expect(201);

      // Passenger 2 can also book
      const res = await request(app)
        .post('/passengers/bookings')
        .set('Cookie', passengerToken2)
        .set('X-CSRF-Token', csrfToken2)
        .send({ tripId: publishedTrip._id.toString() })
        .expect(201);

      expect(res.body.passengerId).toBe(passenger2._id.toString());
    });
  });

  describe('GET /passengers/bookings', () => {
    let publishedTrip;

    beforeEach(async () => {
      publishedTrip = await createTrip('published', 3);

      // Create sample bookings for passenger1
      await BookingRequestModel.create({
        tripId: publishedTrip._id,
        passengerId: passenger1._id,
        status: 'pending',
        note: 'Booking 1',
        seats: 1
      });

      await BookingRequestModel.create({
        tripId: publishedTrip._id,
        passengerId: passenger1._id,
        status: 'canceled_by_passenger',
        note: 'Booking 2 (canceled)',
        seats: 1
      });

      // Create booking for passenger2 (should not appear in passenger1's list)
      await BookingRequestModel.create({
        tripId: publishedTrip._id,
        passengerId: passenger2._id,
        status: 'pending',
        note: 'Passenger2 booking',
        seats: 1
      });
    });

    it('should list only caller\'s bookings', async () => {
      const res = await request(app)
        .get('/passengers/bookings')
        .set('Cookie', passengerToken1)
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');

      // Passenger1 should see 2 bookings (not passenger2's)
      expect(res.body.items.length).toBe(2);
      expect(res.body.items.every(b => b.passengerId === passenger1._id.toString())).toBe(true);
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/passengers/bookings')
        .query({ status: 'pending' })
        .set('Cookie', passengerToken1)
        .expect(200);

      expect(res.body.items.length).toBe(1);
      expect(res.body.items[0].status).toBe('pending');
    });

    it('should handle pagination', async () => {
      // Create more bookings
      for (let i = 0; i < 10; i++) {
        await BookingRequestModel.create({
          tripId: publishedTrip._id,
          passengerId: passenger1._id,
          status: 'pending',
          note: `Booking ${i}`,
          seats: 1
        });
      }

      const res = await request(app)
        .get('/passengers/bookings')
        .query({ page: 1, pageSize: 5 })
        .set('Cookie', passengerToken1)
        .expect(200);

      expect(res.body.items.length).toBe(5);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(5);
      expect(res.body.total).toBe(12); // 2 original + 10 new
    });

    it('should enforce max pageSize of 50', async () => {
      await request(app)
        .get('/passengers/bookings')
        .query({ pageSize: 100 })
        .set('Cookie', passengerToken1)
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/passengers/bookings')
        .expect(401);
    });
  });

  describe('DELETE /passengers/bookings/:bookingId', () => {
    let publishedTrip, booking1, booking2;

    beforeEach(async () => {
      publishedTrip = await createTrip('published', 3);

      booking1 = await BookingRequestModel.create({
        tripId: publishedTrip._id,
        passengerId: passenger1._id,
        status: 'pending',
        note: 'Booking to cancel',
        seats: 1
      });

      booking2 = await BookingRequestModel.create({
        tripId: publishedTrip._id,
        passengerId: passenger2._id,
        status: 'pending',
        note: 'Passenger2 booking',
        seats: 1
      });
    });

    it('should cancel own booking (owner-only)', async () => {
      const res = await request(app)
        .delete(`/passengers/bookings/${booking1._id}`)
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .expect(200);

      expect(res.body.id).toBe(booking1._id.toString());
      expect(res.body.status).toBe('canceled_by_passenger');
    });

    it('should be idempotent (cancel already canceled)', async () => {
      // First cancel
      await request(app)
        .delete(`/passengers/bookings/${booking1._id}`)
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .expect(200);

      // Second cancel (idempotent)
      const res = await request(app)
        .delete(`/passengers/bookings/${booking1._id}`)
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .expect(200);

      expect(res.body.status).toBe('canceled_by_passenger');
    });

    it('should reject canceling someone else\'s booking (403)', async () => {
      const res = await request(app)
        .delete(`/passengers/bookings/${booking2._id}`)
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .expect(403);

      expect(res.body.code).toBe('forbidden_owner');
    });

    it('should reject canceling non-pending booking (409)', async () => {
      // Manually set booking to accepted
      await BookingRequestModel.findByIdAndUpdate(booking1._id, { status: 'accepted' });

      const res = await request(app)
        .delete(`/passengers/bookings/${booking1._id}`)
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .expect(409);

      expect(res.body.code).toBe('invalid_state');
    });

    it('should return 404 for non-existent booking', async () => {
      await request(app)
        .delete('/passengers/bookings/507f1f77bcf86cd799439011')
        .set('Cookie', passengerToken1)
        .set('X-CSRF-Token', csrfToken1)
        .expect(404);
    });

    it('should require authentication', async () => {
      await request(app)
        .delete(`/passengers/bookings/${booking1._id}`)
        .expect(401);
    });

    it('should require CSRF token', async () => {
      await request(app)
        .delete(`/passengers/bookings/${booking1._id}`)
        .set('Cookie', passengerToken1)
        .expect(403);
    });
  });
});

