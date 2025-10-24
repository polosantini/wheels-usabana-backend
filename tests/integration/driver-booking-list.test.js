/**
 * Integration Tests: Driver Booking Requests List (Subtask 3.3.2)
 * 
 * Tests for GET /drivers/trips/:tripId/booking-requests
 * 
 * Coverage:
 * - List booking requests for owned trip
 * - Filter by status (single and array)
 * - Pagination (page, pageSize)
 * - Ownership enforcement (403 forbidden_owner)
 * - Trip not found (404)
 * - Invalid query parameters (400)
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  createTestUser,
  createTestVehicle,
  createTestTrip,
  createTestBookingRequest,
  loginUser,
  cleanupTestData
} = require('../helpers/testHelpers');

describe('GET /drivers/trips/:tripId/booking-requests', () => {
  let driver1Token, driver2Token, passengerToken;
  let driver1Id, driver2Id, passengerId;
  let vehicleId, tripId;

  beforeAll(async () => {
    // Create driver 1 (trip owner)
    const driver1 = await createTestUser('driver', 'driver1-booking-list@unisabana.edu.co');
    driver1Id = driver1.id;
    driver1Token = await loginUser(driver1.corporateEmail, 'SecurePass123!');

    // Create vehicle for driver 1
    vehicleId = await createTestVehicle(driver1Id, 'ABC123', 'Toyota', 'Corolla', 2020, 4);

    // Create trip for driver 1
    tripId = await createTestTrip(driver1Id, vehicleId, {
      status: 'published',
      totalSeats: 3,
      departureAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // +7 days
    });

    // Create driver 2 (not owner)
    const driver2 = await createTestUser('driver', 'driver2-booking-list@unisabana.edu.co');
    driver2Id = driver2.id;
    driver2Token = await loginUser(driver2.corporateEmail, 'SecurePass123!');

    // Create passenger
    const passenger = await createTestUser('passenger', 'passenger-booking-list@unisabana.edu.co');
    passengerId = passenger.id;
    passengerToken = await loginUser(passenger.corporateEmail, 'SecurePass123!');

    // Create booking requests with different statuses
    await createTestBookingRequest(passengerId, tripId, { seats: 1, note: 'Request 1', status: 'pending' });
    await createTestBookingRequest(passengerId, tripId, { seats: 1, note: 'Request 2', status: 'accepted' });
    await createTestBookingRequest(passengerId, tripId, { seats: 1, note: 'Request 3', status: 'declined' });
    await createTestBookingRequest(passengerId, tripId, { seats: 1, note: 'Request 4', status: 'canceled_by_passenger' });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('Success Cases', () => {
    test('200 - List all booking requests for owned trip', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('pageSize', 10);
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('totalPages');

      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.length).toBeGreaterThan(0);

      // Verify response structure
      const item = response.body.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('tripId', tripId);
      expect(item).toHaveProperty('passengerId');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('seats');
      expect(item).toHaveProperty('note');
      expect(item).toHaveProperty('createdAt');

      // Verify no PII leak (acceptedBy, declinedBy should NOT be exposed)
      expect(item).not.toHaveProperty('acceptedBy');
      expect(item).not.toHaveProperty('declinedBy');
    });

    test('200 - Filter by single status (pending)', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ status: 'pending' })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      expect(response.body.items.length).toBeGreaterThan(0);
      response.body.items.forEach((item) => {
        expect(item.status).toBe('pending');
      });
    });

    test('200 - Filter by multiple statuses (accepted, declined)', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ status: ['accepted', 'declined'] })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      expect(response.body.items.length).toBeGreaterThan(0);
      response.body.items.forEach((item) => {
        expect(['accepted', 'declined']).toContain(item.status);
      });
    });

    test('200 - Pagination works (page 1, pageSize 2)', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ page: 1, pageSize: 2 })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(2);
      expect(response.body.items.length).toBeLessThanOrEqual(2);
    });

    test('200 - Empty results when no matching status', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ status: 'expired' })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
      expect(response.body.totalPages).toBe(0);
    });
  });

  describe('Error Cases - Validation', () => {
    test('400 - Invalid status value', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ status: 'invalid_status' })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(400);

      expect(response.body).toHaveProperty('code', 'invalid_schema');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('details');
    });

    test('400 - Invalid page (negative)', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ page: -1 })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(400);

      expect(response.body).toHaveProperty('code', 'invalid_schema');
    });

    test('400 - Invalid pageSize (exceeds max 50)', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ pageSize: 51 })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(400);

      expect(response.body).toHaveProperty('code', 'invalid_schema');
    });

    test('400 - Invalid tripId format', async () => {
      const response = await request(app)
        .get('/drivers/trips/invalid-id/booking-requests')
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(400);

      expect(response.body).toHaveProperty('code', 'invalid_schema');
    });
  });

  describe('Error Cases - Authorization', () => {
    test('401 - No authentication token', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .expect(401);

      expect(response.body).toHaveProperty('code', 'unauthorized');
    });

    test('403 - Driver does not own trip', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .set('Cookie', `access_token=${driver2Token}`)
        .expect(403);

      expect(response.body).toHaveProperty('code', 'forbidden_owner');
      expect(response.body.message).toContain('Trip does not belong to the driver');
    });

    test('403 - Passenger cannot access driver endpoint', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .set('Cookie', `access_token=${passengerToken}`)
        .expect(403);

      expect(response.body).toHaveProperty('code');
      // Either forbidden_owner or forbidden_role depending on middleware order
    });
  });

  describe('Error Cases - Not Found', () => {
    test('404 - Trip does not exist', async () => {
      const nonExistentTripId = '66a1b2c3d4e5f6a7b8c9d0e1';
      const response = await request(app)
        .get(`/drivers/trips/${nonExistentTripId}/booking-requests`)
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(404);

      expect(response.body).toHaveProperty('code', 'trip_not_found');
    });
  });

  describe('Edge Cases', () => {
    test('200 - Page beyond total pages returns empty items', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .query({ page: 999 })
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.page).toBe(999);
    });

    test('200 - Default pagination when not specified', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(10);
    });
  });

  describe('Security - PII Leak Prevention', () => {
    test('Response does not expose acceptedBy or declinedBy fields', async () => {
      const response = await request(app)
        .get(`/drivers/trips/${tripId}/booking-requests`)
        .set('Cookie', `access_token=${driver1Token}`)
        .expect(200);

      response.body.items.forEach((item) => {
        expect(item).not.toHaveProperty('acceptedBy');
        expect(item).not.toHaveProperty('declinedBy');
        // Only timestamps should be exposed
        expect(item).toHaveProperty('acceptedAt');
        expect(item).toHaveProperty('declinedAt');
        expect(item).toHaveProperty('canceledAt');
      });
    });
  });
});
