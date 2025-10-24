/**
 * Trip Management Integration Tests (Subtask 3.1.6)
 * 
 * Coverage:
 * ✅ GET /drivers/trips - List with filters & pagination
 * ✅ PATCH /drivers/trips/:id - Update with transitions
 * ✅ DELETE /drivers/trips/:id - Cancel with idempotency
 */

const request = require('supertest');
const app = require('../../src/app');
const connectDB = require('../../src/infrastructure/database/connection');
const UserModel = require('../../src/infrastructure/database/models/UserModel');
const VehicleModel = require('../../src/infrastructure/database/models/VehicleModel');
const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
const bcrypt = require('bcrypt');

describe('Trip Management - Integration Tests (Subtask 3.1.6)', () => {
  let driverUser = null;
  let otherDriver = null;
  let vehicle = null;
  let authCookie = null;
  let otherAuthCookie = null;
  let csrfToken = null;
  let otherCsrfToken = null;
  const testPassword = 'TestPassword123!';

  beforeAll(async () => {
    await connectDB();

    // Clean up test data
    await UserModel.deleteMany({
      corporateEmail: { $regex: /tripmgmt.*@unisabana\.edu\.co/i }
    });
    await VehicleModel.deleteMany({});
    await TripOfferModel.deleteMany({});

    // Create driver users
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    driverUser = await UserModel.create({
      role: 'driver',
      firstName: 'TripMgmt',
      lastName: 'Driver1',
      universityId: '998001',
      corporateEmail: 'tripmgmt-driver1@unisabana.edu.co',
      phone: '+573007777777',
      password: hashedPassword
    });

    otherDriver = await UserModel.create({
      role: 'driver',
      firstName: 'TripMgmt',
      lastName: 'Driver2',
      universityId: '998002',
      corporateEmail: 'tripmgmt-driver2@unisabana.edu.co',
      phone: '+573008888888',
      password: hashedPassword
    });

    // Create vehicle for main driver
    vehicle = await VehicleModel.create({
      driverId: driverUser._id,
      plate: 'MGT123',
      brand: 'Toyota',
      model: 'Corolla',
      color: 'White',
      capacity: 4,
      vehiclePhotoUrl: '/uploads/vehicles/test.jpg',
      soatPhotoUrl: '/uploads/vehicles/soat.pdf'
    });

    // Login both drivers
    const login1 = await request(app)
      .post('/auth/login')
      .send({
        corporateEmail: driverUser.corporateEmail,
        password: testPassword
      })
      .expect(200);

    authCookie = login1.headers['set-cookie'];
    const csrf1 = authCookie.find(c => c.startsWith('csrf_token='));
    if (csrf1) {
      csrfToken = csrf1.split(';')[0].replace('csrf_token=', '');
    }

    const login2 = await request(app)
      .post('/auth/login')
      .send({
        corporateEmail: otherDriver.corporateEmail,
        password: testPassword
      })
      .expect(200);

    otherAuthCookie = login2.headers['set-cookie'];
    const csrf2 = otherAuthCookie.find(c => c.startsWith('csrf_token='));
    if (csrf2) {
      otherCsrfToken = csrf2.split(';')[0].replace('csrf_token=', '');
    }

    // Create test trips for listing/filtering
    const now = Date.now();
    const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
    const in2Days = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const in3Days = new Date(now + 3 * 24 * 60 * 60 * 1000);

    await TripOfferModel.create([
      {
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Origin A', geo: { lat: 4.7, lng: -74.0 } },
        destination: { text: 'Dest A', geo: { lat: 4.6, lng: -74.1 } },
        departureAt: tomorrow,
        estimatedArrivalAt: new Date(tomorrow.getTime() + 60 * 60 * 1000),
        pricePerSeat: 5000,
        totalSeats: 3,
        status: 'published',
        notes: 'Trip 1'
      },
      {
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Origin B', geo: { lat: 4.8, lng: -74.0 } },
        destination: { text: 'Dest B', geo: { lat: 4.5, lng: -74.2 } },
        departureAt: in2Days,
        estimatedArrivalAt: new Date(in2Days.getTime() + 60 * 60 * 1000),
        pricePerSeat: 6000,
        totalSeats: 2,
        status: 'draft',
        notes: 'Trip 2'
      },
      {
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Origin C', geo: { lat: 4.9, lng: -74.0 } },
        destination: { text: 'Dest C', geo: { lat: 4.4, lng: -74.3 } },
        departureAt: in3Days,
        estimatedArrivalAt: new Date(in3Days.getTime() + 60 * 60 * 1000),
        pricePerSeat: 7000,
        totalSeats: 4,
        status: 'published',
        notes: 'Trip 3'
      },
      {
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Origin D', geo: { lat: 5.0, lng: -74.0 } },
        destination: { text: 'Dest D', geo: { lat: 4.3, lng: -74.4 } },
        departureAt: new Date(now - 2 * 24 * 60 * 60 * 1000), // Past
        estimatedArrivalAt: new Date(now - 24 * 60 * 60 * 1000),
        pricePerSeat: 8000,
        totalSeats: 3,
        status: 'completed',
        notes: 'Trip 4'
      }
    ]);
  });

  afterAll(async () => {
    await UserModel.deleteMany({
      corporateEmail: { $regex: /tripmgmt.*@unisabana\.edu\.co/i }
    });
    await VehicleModel.deleteMany({});
    await TripOfferModel.deleteMany({});
    await require('mongoose').connection.close();
  });

  describe('GET /drivers/trips - List My Trips', () => {
    describe('✅ Basic Listing', () => {
      it('should return all trips for the driver with default pagination', async () => {
        const res = await request(app)
          .get('/drivers/trips')
          .set('Cookie', authCookie)
          .expect(200)
          .expect('Content-Type', /json/);

        expect(res.body).toHaveProperty('items');
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items.length).toBeGreaterThanOrEqual(4);
        expect(res.body).toHaveProperty('page', 1);
        expect(res.body).toHaveProperty('pageSize', 10);
        expect(res.body).toHaveProperty('total');
        expect(res.body).toHaveProperty('totalPages');
      });

      it('should return empty list for driver with no trips', async () => {
        const res = await request(app)
          .get('/drivers/trips')
          .set('Cookie', otherAuthCookie)
          .expect(200);

        expect(res.body.items).toEqual([]);
        expect(res.body.total).toBe(0);
        expect(res.body.totalPages).toBe(0);
      });

      it('should return 401 without authentication', async () => {
        await request(app)
          .get('/drivers/trips')
          .expect(401);
      });
    });

    describe('✅ Filter by Status', () => {
      it('should filter by single status (published)', async () => {
        const res = await request(app)
          .get('/drivers/trips?status=published')
          .set('Cookie', authCookie)
          .expect(200);

        expect(res.body.items).toBeInstanceOf(Array);
        // At least some published trips should exist from beforeAll
        const publishedTrips = res.body.items.filter(t => t.status === 'published');
        expect(publishedTrips.length).toBe(res.body.items.length);
      });

      it('should filter by single status (draft)', async () => {
        const res = await request(app)
          .get('/drivers/trips?status=draft')
          .set('Cookie', authCookie)
          .expect(200);

        expect(res.body.items).toBeInstanceOf(Array);
        // All returned trips should be draft
        res.body.items.forEach(trip => {
          expect(trip.status).toBe('draft');
        });
      });

      it('should filter by multiple statuses (array)', async () => {
        const res = await request(app)
          .get('/drivers/trips?status=published&status=draft')
          .set('Cookie', authCookie)
          .expect(200);

        expect(res.body.items).toBeInstanceOf(Array);
        // All returned trips should be either published or draft
        res.body.items.forEach(trip => {
          expect(['published', 'draft']).toContain(trip.status);
        });
      });

      it('should return 400 for invalid status value', async () => {
        const res = await request(app)
          .get('/drivers/trips?status=invalid_status')
          .set('Cookie', authCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('✅ Filter by Date Range', () => {
      it('should filter by fromDate', async () => {
        const fromDate = new Date(Date.now() + 1.5 * 24 * 60 * 60 * 1000).toISOString();
        const res = await request(app)
          .get(`/drivers/trips?fromDate=${fromDate}`)
          .set('Cookie', authCookie)
          .expect(200);

        res.body.items.forEach(trip => {
          expect(new Date(trip.departureAt).getTime()).toBeGreaterThanOrEqual(new Date(fromDate).getTime());
        });
      });

      it('should filter by toDate', async () => {
        const toDate = new Date(Date.now() + 1.5 * 24 * 60 * 60 * 1000).toISOString();
        const res = await request(app)
          .get(`/drivers/trips?toDate=${toDate}`)
          .set('Cookie', authCookie)
          .expect(200);

        res.body.items.forEach(trip => {
          expect(new Date(trip.departureAt).getTime()).toBeLessThanOrEqual(new Date(toDate).getTime());
        });
      });

      it('should filter by date range (fromDate and toDate)', async () => {
        const fromDate = new Date(Date.now() + 0.5 * 24 * 60 * 60 * 1000).toISOString();
        const toDate = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000).toISOString();
        const res = await request(app)
          .get(`/drivers/trips?fromDate=${fromDate}&toDate=${toDate}`)
          .set('Cookie', authCookie)
          .expect(200);

        res.body.items.forEach(trip => {
          const departure = new Date(trip.departureAt).getTime();
          expect(departure).toBeGreaterThanOrEqual(new Date(fromDate).getTime());
          expect(departure).toBeLessThanOrEqual(new Date(toDate).getTime());
        });
      });

      it('should return 400 if toDate is before fromDate', async () => {
        const fromDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
        const toDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
        const res = await request(app)
          .get(`/drivers/trips?fromDate=${fromDate}&toDate=${toDate}`)
          .set('Cookie', authCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('✅ Pagination', () => {
      it('should respect page and pageSize parameters', async () => {
        const res = await request(app)
          .get('/drivers/trips?page=1&pageSize=2')
          .set('Cookie', authCookie)
          .expect(200);

        expect(res.body.page).toBe(1);
        expect(res.body.pageSize).toBe(2);
        expect(res.body.items.length).toBeLessThanOrEqual(2);
      });

      it('should return page 2 with correct results', async () => {
        const res = await request(app)
          .get('/drivers/trips?page=2&pageSize=2')
          .set('Cookie', authCookie)
          .expect(200);

        expect(res.body.page).toBe(2);
        expect(res.body.pageSize).toBe(2);
      });

      it('should return 400 for pageSize > 50', async () => {
        const res = await request(app)
          .get('/drivers/trips?pageSize=51')
          .set('Cookie', authCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for invalid page number', async () => {
        const res = await request(app)
          .get('/drivers/trips?page=0')
          .set('Cookie', authCookie)
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('✅ Sorting', () => {
      it('should return trips sorted by departureAt descending (most recent first)', async () => {
        const res = await request(app)
          .get('/drivers/trips')
          .set('Cookie', authCookie)
          .expect(200);

        for (let i = 0; i < res.body.items.length - 1; i++) {
          const current = new Date(res.body.items[i].departureAt).getTime();
          const next = new Date(res.body.items[i + 1].departureAt).getTime();
          expect(current).toBeGreaterThanOrEqual(next);
        }
      });
    });
  });

  describe('PATCH /drivers/trips/:id - Update Trip Offer', () => {
    let testTrip = null;

    beforeEach(async () => {
      // Create a fresh trip for each update test
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      testTrip = await TripOfferModel.create({
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Update Origin', geo: { lat: 4.7, lng: -74.0 } },
        destination: { text: 'Update Dest', geo: { lat: 4.6, lng: -74.1 } },
        departureAt: tomorrow,
        estimatedArrivalAt: new Date(tomorrow.getTime() + 60 * 60 * 1000),
        pricePerSeat: 5000,
        totalSeats: 3,
        status: 'published',
        notes: 'Original notes'
      });
    });

    afterEach(async () => {
      if (testTrip) {
        await TripOfferModel.findByIdAndDelete(testTrip._id);
      }
    });

    describe('✅ Happy Path - Allowed Fields', () => {
      it('should update pricePerSeat', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ pricePerSeat: 6500 })
          .expect(200);

        expect(res.body.pricePerSeat).toBe(6500);
        expect(res.body.id).toBe(testTrip._id.toString());
      });

      it('should update totalSeats within vehicle capacity', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ totalSeats: 4 })
          .expect(200);

        expect(res.body.totalSeats).toBe(4);
      });

      it('should update notes', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ notes: 'Updated notes here' })
          .expect(200);

        expect(res.body.notes).toBe('Updated notes here');
      });

      it('should update multiple fields at once', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({
            pricePerSeat: 7000,
            totalSeats: 2,
            notes: 'Multiple updates'
          })
          .expect(200);

        expect(res.body.pricePerSeat).toBe(7000);
        expect(res.body.totalSeats).toBe(2);
        expect(res.body.notes).toBe('Multiple updates');
      });
    });

    describe('✅ Status Transitions', () => {
      it('should NOT allow transition from published to draft (invalid)', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ status: 'draft' })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_transition');
      });

      it('should transition from draft to published', async () => {
        // First set to draft
        testTrip.status = 'draft';
        await testTrip.save();

        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ status: 'published' })
          .expect(200);

        expect(res.body.status).toBe('published');
      });

      it('should transition from published to canceled', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ status: 'canceled' })
          .expect(200);

        expect(res.body.status).toBe('canceled');
      });

      it('should return 409 for invalid transition (canceled to published)', async () => {
        // First cancel the trip
        testTrip.status = 'canceled';
        await testTrip.save();

        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ status: 'published' })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_transition');
      });

      it('should return 409 for invalid transition (completed to published)', async () => {
        // Set trip as completed
        testTrip.status = 'completed';
        await testTrip.save();

        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ status: 'published' })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_transition');
      });
    });

    describe('✅ Validation Errors', () => {
      it('should return 400 for negative pricePerSeat', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ pricePerSeat: -100 })
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for totalSeats exceeding vehicle capacity', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ totalSeats: 10 }) // Vehicle capacity is 4
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
        expect(res.body.message).toContain('capacity');
      });

      it('should return 400 for invalid status value', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ status: 'invalid_status' })
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });

      it('should return 400 for empty request body', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({})
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('✅ Authorization', () => {
      it('should return 403 for non-owner trying to update', async () => {
        const res = await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', otherAuthCookie)
          .set('X-CSRF-Token', otherCsrfToken)
          .send({ pricePerSeat: 10000 })
          .expect(403);

        expect(res.body).toHaveProperty('code', 'forbidden_owner');
      });

      it('should return 401 without authentication', async () => {
        await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .send({ pricePerSeat: 10000 })
          .expect(401);
      });

      it('should return 403 without CSRF token', async () => {
        await request(app)
          .patch(`/drivers/trips/${testTrip._id}`)
          .set('Cookie', authCookie)
          .send({ pricePerSeat: 10000 })
          .expect(403);
      });
    });

    describe('✅ Not Found', () => {
      it('should return 404 for non-existent trip ID', async () => {
        const nonExistentId = '507f1f77bcf86cd799439011';
        const res = await request(app)
          .patch(`/drivers/trips/${nonExistentId}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .send({ pricePerSeat: 10000 })
          .expect(404);

        expect(res.body).toHaveProperty('code', 'trip_not_found');
      });
    });
  });

  describe('DELETE /drivers/trips/:id - Cancel Trip Offer', () => {
    let publishedTrip = null;
    let draftTrip = null;
    let completedTrip = null;

    beforeEach(async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Create trips with different statuses
      publishedTrip = await TripOfferModel.create({
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Cancel Origin A', geo: { lat: 4.7, lng: -74.0 } },
        destination: { text: 'Cancel Dest A', geo: { lat: 4.6, lng: -74.1 } },
        departureAt: tomorrow,
        estimatedArrivalAt: new Date(tomorrow.getTime() + 60 * 60 * 1000),
        pricePerSeat: 5000,
        totalSeats: 3,
        status: 'published',
        notes: 'Published trip'
      });

      draftTrip = await TripOfferModel.create({
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Cancel Origin B', geo: { lat: 4.8, lng: -74.0 } },
        destination: { text: 'Cancel Dest B', geo: { lat: 4.5, lng: -74.2 } },
        departureAt: tomorrow,
        estimatedArrivalAt: new Date(tomorrow.getTime() + 60 * 60 * 1000),
        pricePerSeat: 6000,
        totalSeats: 2,
        status: 'draft',
        notes: 'Draft trip'
      });

      completedTrip = await TripOfferModel.create({
        driverId: driverUser._id,
        vehicleId: vehicle._id,
        origin: { text: 'Cancel Origin C', geo: { lat: 4.9, lng: -74.0 } },
        destination: { text: 'Cancel Dest C', geo: { lat: 4.4, lng: -74.3 } },
        departureAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        estimatedArrivalAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        pricePerSeat: 7000,
        totalSeats: 4,
        status: 'completed',
        notes: 'Completed trip'
      });
    });

    afterEach(async () => {
      if (publishedTrip) await TripOfferModel.findByIdAndDelete(publishedTrip._id);
      if (draftTrip) await TripOfferModel.findByIdAndDelete(draftTrip._id);
      if (completedTrip) await TripOfferModel.findByIdAndDelete(completedTrip._id);
    });

    describe('✅ AC1: Owner can cancel → 200 status=canceled', () => {
      it('should cancel published trip successfully', async () => {
        const res = await request(app)
          .delete(`/drivers/trips/${publishedTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .expect(200);

        expect(res.body).toHaveProperty('id', publishedTrip._id.toString());
        expect(res.body).toHaveProperty('status', 'canceled');

        // Verify in database
        const dbTrip = await TripOfferModel.findById(publishedTrip._id);
        expect(dbTrip.status).toBe('canceled');
      });

      it('should cancel draft trip successfully', async () => {
        const res = await request(app)
          .delete(`/drivers/trips/${draftTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .expect(200);

        expect(res.body).toHaveProperty('status', 'canceled');
      });
    });

    describe('✅ AC2: Non-owner → 403', () => {
      it('should return 403 for non-owner trying to cancel', async () => {
        const res = await request(app)
          .delete(`/drivers/trips/${publishedTrip._id}`)
          .set('Cookie', otherAuthCookie)
          .set('X-CSRF-Token', otherCsrfToken)
          .expect(403);

        expect(res.body).toHaveProperty('code', 'forbidden_owner');
        expect(res.body.message).toContain('does not belong to the driver');
      });

      it('should return 401 without authentication', async () => {
        await request(app)
          .delete(`/drivers/trips/${publishedTrip._id}`)
          .expect(401);
      });

      it('should return 403 without CSRF token', async () => {
        await request(app)
          .delete(`/drivers/trips/${publishedTrip._id}`)
          .set('Cookie', authCookie)
          .expect(403);
      });
    });

    describe('✅ AC3: Already canceled → 200 (idempotent)', () => {
      it('should return 200 when canceling already canceled trip', async () => {
        // First cancellation
        await request(app)
          .delete(`/drivers/trips/${publishedTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .expect(200);

        // Second cancellation (idempotent)
        const res = await request(app)
          .delete(`/drivers/trips/${publishedTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .expect(200);

        expect(res.body).toHaveProperty('status', 'canceled');
      });

      it('should be idempotent across multiple calls', async () => {
        // Cancel multiple times
        const results = await Promise.all([
          request(app)
            .delete(`/drivers/trips/${draftTrip._id}`)
            .set('Cookie', authCookie)
            .set('X-CSRF-Token', csrfToken),
          request(app)
            .delete(`/drivers/trips/${draftTrip._id}`)
            .set('Cookie', authCookie)
            .set('X-CSRF-Token', csrfToken),
          request(app)
            .delete(`/drivers/trips/${draftTrip._id}`)
            .set('Cookie', authCookie)
            .set('X-CSRF-Token', csrfToken)
        ]);

        // All should return 200
        results.forEach(res => {
          expect(res.status).toBe(200);
          expect(res.body.status).toBe('canceled');
        });
      });
    });

    describe('✅ AC4: Completed trips cannot be canceled → 409 invalid_transition', () => {
      it('should return 409 when trying to cancel completed trip', async () => {
        const res = await request(app)
          .delete(`/drivers/trips/${completedTrip._id}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .expect(409);

        expect(res.body).toHaveProperty('code', 'invalid_transition');
        expect(res.body.message).toContain('Completed trips cannot be canceled');

        // Verify status unchanged in database
        const dbTrip = await TripOfferModel.findById(completedTrip._id);
        expect(dbTrip.status).toBe('completed');
      });
    });

    describe('✅ Not Found', () => {
      it('should return 404 for non-existent trip ID', async () => {
        const nonExistentId = '507f1f77bcf86cd799439011';
        const res = await request(app)
          .delete(`/drivers/trips/${nonExistentId}`)
          .set('Cookie', authCookie)
          .set('X-CSRF-Token', csrfToken)
          .expect(404);

        expect(res.body).toHaveProperty('code', 'trip_not_found');
      });
    });
  });
});

