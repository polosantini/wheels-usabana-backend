/**
 * Trip Creation Integration Tests (Subtask 3.1.2)
 * 
 * Tests for POST /drivers/trips endpoint
 * 
 * Acceptance Criteria:
 * ✅ Driver with valid payload → 201 DTO
 * ✅ Invalid time/capacity/ownership → 400/403
 * ✅ Overlap violation (if enabled) → 409 overlapping_trip
 */

const request = require('supertest');
const app = require('../../src/app');
const connectDB = require('../../src/infrastructure/database/connection');
const UserModel = require('../../src/infrastructure/database/models/UserModel');
const VehicleModel = require('../../src/infrastructure/database/models/VehicleModel');
const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
const bcrypt = require('bcrypt');
const { generateCsrfToken } = require('../../src/utils/csrf');

describe('Trip Creation - Integration Tests (Subtask 3.1.2)', () => {
  let driverUser = null;
  let passengerUser = null;
  let driverVehicle = null;
  let driverAuthCookie = null;
  let passengerAuthCookie = null;
  let csrfToken = null;
  const testPassword = 'TestPassword123!';

  beforeAll(async () => {
    await connectDB();

    // Clean up test data
    await UserModel.deleteMany({
      corporateEmail: { $regex: /triptest.*@unisabana\.edu\.co/i }
    });
    await VehicleModel.deleteMany({});
    await TripOfferModel.deleteMany({});

    // Create driver user
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    driverUser = await UserModel.create({
      role: 'driver',
      firstName: 'Driver',
      lastName: 'Test',
      universityId: '999001',
      corporateEmail: 'triptest-driver@unisabana.edu.co',
      phone: '+573001111111',
      password: hashedPassword
    });

    // Create passenger user
    passengerUser = await UserModel.create({
      role: 'passenger',
      firstName: 'Passenger',
      lastName: 'Test',
      universityId: '999002',
      corporateEmail: 'triptest-passenger@unisabana.edu.co',
      phone: '+573002222222',
      password: hashedPassword
    });

    // Create vehicle for driver
    driverVehicle = await VehicleModel.create({
      driverId: driverUser._id,
      plate: 'TST123',
      brand: 'Toyota',
      model: 'Corolla',
      capacity: 4,
      vehiclePhotoUrl: '/uploads/vehicles/test.jpg',
      soatPhotoUrl: '/uploads/vehicles/soat.pdf'
    });

    // Login driver
    const driverLoginRes = await request(app)
      .post('/auth/login')
      .send({
        corporateEmail: 'triptest-driver@unisabana.edu.co',
        password: testPassword
      })
      .expect(200);

    driverAuthCookie = driverLoginRes.headers['set-cookie'];

    // Login passenger
    const passengerLoginRes = await request(app)
      .post('/auth/login')
      .send({
        corporateEmail: 'triptest-passenger@unisabana.edu.co',
        password: testPassword
      })
      .expect(200);

    passengerAuthCookie = passengerLoginRes.headers['set-cookie'];

    // Extract CSRF token from driver login
    const csrfCookie = driverAuthCookie.find(c => c.startsWith('csrf_token='));
    if (csrfCookie) {
      csrfToken = csrfCookie.split('=')[1].split(';')[0];
    }
  });

  beforeEach(async () => {
    // Clean trips before each test
    await TripOfferModel.deleteMany({});
  });

  afterAll(async () => {
    await UserModel.deleteMany({
      corporateEmail: { $regex: /triptest.*@unisabana\.edu\.co/i }
    });
    await VehicleModel.deleteMany({});
    await TripOfferModel.deleteMany({});
    await require('mongoose').connection.close();
  });

  describe('✅ AC1: Driver with valid payload → 201 DTO', () => {
    it('should create a published trip with valid data', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const tripData = {
        vehicleId: driverVehicle._id.toString(),
        origin: {
          text: 'Campus Norte',
          geo: { lat: 4.703, lng: -74.041 }
        },
        destination: {
          text: 'Campus Sur',
          geo: { lat: 4.627, lng: -74.064 }
        },
        departureAt: tomorrow.toISOString(),
        estimatedArrivalAt: tomorrowPlus1h.toISOString(),
        pricePerSeat: 6000,
        totalSeats: 3,
        status: 'published',
        notes: 'Two backpacks max.'
      };

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send(tripData)
        .expect(201)
        .expect('Content-Type', /json/);

      // Verify response structure
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('driverId', driverUser._id.toString());
      expect(res.body).toHaveProperty('vehicleId', driverVehicle._id.toString());
      expect(res.body).toHaveProperty('status', 'published');
      expect(res.body).toHaveProperty('pricePerSeat', 6000);
      expect(res.body).toHaveProperty('totalSeats', 3);
      expect(res.body).toHaveProperty('notes', 'Two backpacks max.');
      expect(res.body).toHaveProperty('createdAt');
      expect(res.body).toHaveProperty('updatedAt');

      // Verify origin/destination structure
      expect(res.body.origin).toHaveProperty('text', 'Campus Norte');
      expect(res.body.origin.geo).toHaveProperty('lat', 4.703);
      expect(res.body.origin.geo).toHaveProperty('lng', -74.041);

      // Verify dates
      expect(new Date(res.body.departureAt).toISOString()).toBe(tomorrow.toISOString());
      expect(new Date(res.body.estimatedArrivalAt).toISOString()).toBe(tomorrowPlus1h.toISOString());

      // Verify persisted in database
      const dbTrip = await TripOfferModel.findById(res.body.id);
      expect(dbTrip).toBeTruthy();
      expect(dbTrip.status).toBe('published');
      expect(dbTrip.driverId.toString()).toBe(driverUser._id.toString());
    });

    it('should create a draft trip (not visible to passengers)', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const tripData = {
        vehicleId: driverVehicle._id.toString(),
        origin: {
          text: 'Chía Centro',
          geo: { lat: 4.858, lng: -74.059 }
        },
        destination: {
          text: 'Bogotá Centro',
          geo: { lat: 4.598, lng: -74.076 }
        },
        departureAt: tomorrow.toISOString(),
        estimatedArrivalAt: tomorrowPlus1h.toISOString(),
        pricePerSeat: 8000,
        totalSeats: 4,
        status: 'draft',
        notes: ''
      };

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send(tripData)
        .expect(201);

      expect(res.body).toHaveProperty('status', 'draft');
    });

    it('should default to published status if not provided', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const tripData = {
        vehicleId: driverVehicle._id.toString(),
        origin: {
          text: 'Test Origin',
          geo: { lat: 4.7, lng: -74.0 }
        },
        destination: {
          text: 'Test Destination',
          geo: { lat: 4.6, lng: -74.1 }
        },
        departureAt: tomorrow.toISOString(),
        estimatedArrivalAt: tomorrowPlus1h.toISOString(),
        pricePerSeat: 5000,
        totalSeats: 2
        // status not provided
      };

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send(tripData)
        .expect(201);

      expect(res.body).toHaveProperty('status', 'published');
    });
  });

  describe('✅ AC2: Invalid time/capacity/ownership → 400/403', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/drivers/trips')
        .send({})
        .expect(401);

      expect(res.body).toHaveProperty('code', 'unauthorized');
    });

    it('should return 403 for non-driver (passenger role)', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', passengerAuthCookie)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus1h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 2
        })
        .expect(403);

      expect(res.body).toHaveProperty('code', 'forbidden');
    });

    it('should return 403 for vehicle not owned by driver', async () => {
      // Create another vehicle owned by someone else
      const otherVehicle = await VehicleModel.create({
        driverId: passengerUser._id, // Owned by passenger
        plate: 'OTH456',
        brand: 'Honda',
        model: 'Civic',
        capacity: 4,
        vehiclePhotoUrl: '/test.jpg',
        soatPhotoUrl: '/test.pdf'
      });

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: otherVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus1h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 2
        })
        .expect(403);

      expect(res.body).toHaveProperty('code', 'vehicle_ownership_violation');
      expect(res.body).toHaveProperty('message', 'Vehicle does not belong to the driver');

      await VehicleModel.findByIdAndDelete(otherVehicle._id);
    });

    it('should return 400 for departure in the past (published trip)', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yesterdayPlus1h = new Date(yesterday.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: yesterday.toISOString(),
          estimatedArrivalAt: yesterdayPlus1h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 2,
          status: 'published'
        })
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
      expect(res.body.message).toContain('future');
    });

    it('should return 400 for estimatedArrivalAt before departureAt', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const today = new Date();

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: today.toISOString(), // Before departure!
          pricePerSeat: 5000,
          totalSeats: 2
        })
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
    });

    it('should return 400 for totalSeats exceeding vehicle capacity', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus1h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 10 // Exceeds capacity of 4
        })
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
      expect(res.body.message).toContain('capacity');
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString()
          // Missing all other required fields
        })
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
      expect(res.body).toHaveProperty('details');
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it('should return 400 for invalid geo coordinates', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: {
            text: 'Test',
            geo: { lat: 200, lng: -74.0 } // Invalid latitude
          },
          destination: {
            text: 'Test2',
            geo: { lat: 4.6, lng: -74.1 }
          },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus1h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 2
        })
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
    });

    it('should return 400 for negative pricePerSeat', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus1h.toISOString(),
          pricePerSeat: -1000,
          totalSeats: 2
        })
        .expect(400);

      expect(res.body).toHaveProperty('code', 'invalid_schema');
    });
  });

  describe('✅ AC3: Overlap violation → 409 overlapping_trip', () => {
    it('should return 409 for overlapping published trips', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus2h = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000);

      // Create first trip
      const firstTrip = {
        vehicleId: driverVehicle._id.toString(),
        origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
        destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
        departureAt: tomorrow.toISOString(),
        estimatedArrivalAt: tomorrowPlus2h.toISOString(),
        pricePerSeat: 5000,
        totalSeats: 2,
        status: 'published'
      };

      await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send(firstTrip)
        .expect(201);

      // Try to create overlapping trip
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);
      const tomorrowPlus3h = new Date(tomorrow.getTime() + 3 * 60 * 60 * 1000);

      const overlappingTrip = {
        vehicleId: driverVehicle._id.toString(),
        origin: { text: 'C', geo: { lat: 4.8, lng: -74.0 } },
        destination: { text: 'D', geo: { lat: 4.5, lng: -74.2 } },
        departureAt: tomorrowPlus1h.toISOString(), // Overlaps with first trip
        estimatedArrivalAt: tomorrowPlus3h.toISOString(),
        pricePerSeat: 6000,
        totalSeats: 3,
        status: 'published'
      };

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send(overlappingTrip)
        .expect(409);

      expect(res.body).toHaveProperty('code', 'overlapping_trip');
      expect(res.body.message).toContain('overlapping');
    });

    it('should allow draft trips with overlapping times', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus2h = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000);

      // Create published trip
      await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus2h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 2,
          status: 'published'
        })
        .expect(201);

      // Create overlapping DRAFT trip (should succeed)
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);
      const tomorrowPlus3h = new Date(tomorrow.getTime() + 3 * 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'C', geo: { lat: 4.8, lng: -74.0 } },
          destination: { text: 'D', geo: { lat: 4.5, lng: -74.2 } },
          departureAt: tomorrowPlus1h.toISOString(),
          estimatedArrivalAt: tomorrowPlus3h.toISOString(),
          pricePerSeat: 6000,
          totalSeats: 3,
          status: 'draft' // Draft, so overlap check skipped
        })
        .expect(201);

      expect(res.body).toHaveProperty('status', 'draft');
    });
  });

  describe('🔒 Security & Logging', () => {
    it('should require CSRF token for POST requests', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        // No CSRF token
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus1h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 2
        })
        .expect(403);

      expect(res.body).toHaveProperty('code', 'csrf_mismatch');
    });

    it('should include correlationId in all responses', async () => {
      const res = await request(app)
        .post('/drivers/trips')
        .send({})
        .expect(401);

      expect(res.body).toHaveProperty('correlationId');
      expect(typeof res.body.correlationId).toBe('string');
      expect(res.body.correlationId.length).toBeGreaterThan(0);
    });

    it('should never expose internal database fields', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowPlus1h = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/drivers/trips')
        .set('Cookie', driverAuthCookie)
        .set('X-CSRF-Token', csrfToken)
        .send({
          vehicleId: driverVehicle._id.toString(),
          origin: { text: 'A', geo: { lat: 4.7, lng: -74.0 } },
          destination: { text: 'B', geo: { lat: 4.6, lng: -74.1 } },
          departureAt: tomorrow.toISOString(),
          estimatedArrivalAt: tomorrowPlus1h.toISOString(),
          pricePerSeat: 5000,
          totalSeats: 2
        })
        .expect(201);

      // Should not expose MongoDB internal fields
      expect(res.body).not.toHaveProperty('_id');
      expect(res.body).not.toHaveProperty('__v');

      // Should only have DTO fields
      const expectedFields = [
        'id',
        'driverId',
        'vehicleId',
        'origin',
        'destination',
        'departureAt',
        'estimatedArrivalAt',
        'pricePerSeat',
        'totalSeats',
        'status',
        'notes',
        'createdAt',
        'updatedAt'
      ];

      const actualFields = Object.keys(res.body);
      expect(actualFields.sort()).toEqual(expectedFields.sort());
    });
  });
});

