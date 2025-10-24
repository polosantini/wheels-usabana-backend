/**
 * Payment Integration Tests (US-4.1)
 * 
 * Tests for:
 * - US-4.1.2: Create payment intent
 * - US-4.1.3: Webhook handling
 * - US-4.1.4: Get transactions
 * - US-4.1.5: Booking isPaid sync
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const {
  createTestUser,
  createTestTrip,
  createTestBooking,
  cleanupTestData,
  generateAuthToken,
  generateCsrfToken
} = require('../helpers/testHelpers');

const UserModel = require('../../src/infrastructure/database/models/UserModel');
const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');
const TransactionModel = require('../../src/infrastructure/database/models/TransactionModel');

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_123456',
        client_secret: 'pi_test_123456_secret_abc',
        amount: 50000,
        currency: 'cop',
        status: 'requires_payment_method'
      }),
      retrieve: jest.fn().mockResolvedValue({
        id: 'pi_test_123456',
        status: 'succeeded'
      })
    },
    webhooks: {
      constructEvent: jest.fn((payload, signature, secret) => {
        // Simulate signature verification
        if (signature === 'invalid_signature') {
          throw new Error('Invalid signature');
        }
        return JSON.parse(payload);
      })
    }
  }));
});

describe('Payment System Integration Tests (US-4.1)', () => {
  let passengerUser;
  let driverUser;
  let passengerToken;
  let passengerCsrf;
  let driverToken;
  let tripOffer;
  let acceptedBooking;

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI_TEST);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await cleanupTestData();

    // Create test users
    passengerUser = await createTestUser({
      fullName: 'Test Passenger',
      corporateEmail: 'passenger@unisabana.edu.co',
      role: 'passenger'
    });

    driverUser = await createTestUser({
      fullName: 'Test Driver',
      corporateEmail: 'driver@unisabana.edu.co',
      role: 'driver'
    });

    // Generate auth tokens
    const passengerAuth = generateAuthToken(passengerUser);
    passengerToken = passengerAuth.token;
    passengerCsrf = generateCsrfToken();

    const driverAuth = generateAuthToken(driverUser);
    driverToken = driverAuth.token;

    // Create trip offer
    tripOffer = await createTestTrip({
      driverId: driverUser._id,
      origin: 'Universidad de La Sabana',
      destination: 'Centro Chía',
      departureAt: new Date(Date.now() + 86400000), // Tomorrow
      pricePerSeat: 5000,
      availableSeats: 3,
      status: 'published'
    });

    // Create accepted booking
    acceptedBooking = await createTestBooking({
      tripId: tripOffer._id,
      passengerId: passengerUser._id,
      seats: 2,
      status: 'accepted'
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  // ============================================
  // US-4.1.2: CREATE PAYMENT INTENT
  // ============================================

  describe('POST /passengers/payments/intents', () => {
    it('should create payment intent for accepted booking (happy path)', async () => {
      const response = await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${passengerToken}`])
        .set('X-CSRF-Token', passengerCsrf)
        .send({
          bookingId: acceptedBooking._id.toString()
        })
        .expect(201);

      expect(response.body).toMatchObject({
        transactionId: expect.any(String),
        bookingId: acceptedBooking._id.toString(),
        amount: 10000, // 2 seats × 5000
        currency: 'COP',
        provider: 'stripe',
        clientSecret: expect.stringContaining('pi_test_')
      });

      // Verify transaction was created in database
      const transaction = await TransactionModel.findOne({
        bookingId: acceptedBooking._id
      });

      expect(transaction).toBeTruthy();
      expect(transaction.passengerId.toString()).toBe(passengerUser._id.toString());
      expect(transaction.amount).toBe(10000);
      expect(transaction.status).toBe('requires_payment_method');
    });

    it('should reject if booking not in accepted state', async () => {
      // Create pending booking
      const pendingBooking = await createTestBooking({
        tripId: tripOffer._id,
        passengerId: passengerUser._id,
        seats: 1,
        status: 'pending'
      });

      const response = await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${passengerToken}`])
        .set('X-CSRF-Token', passengerCsrf)
        .send({
          bookingId: pendingBooking._id.toString()
        })
        .expect(409);

      expect(response.body.code).toBe('invalid_booking_state');
    });

    it('should reject if not booking owner', async () => {
      // Create another passenger
      const otherPassenger = await createTestUser({
        fullName: 'Other Passenger',
        corporateEmail: 'other@unisabana.edu.co',
        role: 'passenger'
      });

      const otherAuth = generateAuthToken(otherPassenger);

      const response = await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${otherAuth.token}`])
        .set('X-CSRF-Token', passengerCsrf)
        .send({
          bookingId: acceptedBooking._id.toString()
        })
        .expect(403);

      expect(response.body.code).toBe('forbidden_owner');
    });

    it('should reject duplicate payment intent', async () => {
      // Create first intent
      await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${passengerToken}`])
        .set('X-CSRF-Token', passengerCsrf)
        .send({
          bookingId: acceptedBooking._id.toString()
        })
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${passengerToken}`])
        .set('X-CSRF-Token', passengerCsrf)
        .send({
          bookingId: acceptedBooking._id.toString()
        })
        .expect(409);

      expect(response.body.code).toBe('duplicate_payment');
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/passengers/payments/intents')
        .send({
          bookingId: acceptedBooking._id.toString()
        })
        .expect(401);
    });

    it('should require CSRF token', async () => {
      await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${passengerToken}`])
        .send({
          bookingId: acceptedBooking._id.toString()
        })
        .expect(403);
    });

    it('should require passenger role', async () => {
      await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${driverToken}`])
        .set('X-CSRF-Token', passengerCsrf)
        .send({
          bookingId: acceptedBooking._id.toString()
        })
        .expect(403);
    });

    it('should validate bookingId format', async () => {
      const response = await request(app)
        .post('/passengers/payments/intents')
        .set('Cookie', [`access_token=${passengerToken}`])
        .set('X-CSRF-Token', passengerCsrf)
        .send({
          bookingId: 'invalid-id'
        })
        .expect(400);

      expect(response.body.code).toBe('invalid_schema');
    });
  });

  // ============================================
  // US-4.1.3: WEBHOOK HANDLING
  // ============================================

  describe('POST /payments/webhooks/stripe', () => {
    let transaction;

    beforeEach(async () => {
      // Create a transaction to receive webhook
      transaction = await TransactionModel.create({
        bookingId: acceptedBooking._id,
        tripId: tripOffer._id,
        passengerId: passengerUser._id,
        driverId: driverUser._id,
        amount: 10000,
        currency: 'COP',
        seats: 2,
        pricePerSeat: 5000,
        status: 'requires_payment_method',
        provider: 'stripe',
        providerPaymentIntentId: 'pi_test_webhook_123',
        providerClientSecret: 'pi_test_webhook_123_secret'
      });
    });

    it('should process payment_intent.succeeded webhook (US-4.1.5: sync booking)', async () => {
      const webhookPayload = {
        id: 'evt_test_success_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_webhook_123',
            amount: 10000,
            currency: 'cop',
            status: 'succeeded'
          }
        }
      };

      await request(app)
        .post('/payments/webhooks/stripe')
        .set('Stripe-Signature', 'valid_signature')
        .send(webhookPayload)
        .expect(200);

      // Verify transaction updated
      const updatedTransaction = await TransactionModel.findById(transaction._id);
      expect(updatedTransaction.status).toBe('succeeded');
      expect(updatedTransaction.processedAt).toBeTruthy();
      expect(updatedTransaction.metadata.lastEventId).toBe('evt_test_success_1');

      // US-4.1.5: Verify booking isPaid synced
      const updatedBooking = await BookingRequestModel.findById(acceptedBooking._id);
      expect(updatedBooking.isPaid).toBe(true);
    });

    it('should process payment_intent.payment_failed webhook', async () => {
      const webhookPayload = {
        id: 'evt_test_failed_1',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_webhook_123',
            status: 'failed',
            last_payment_error: {
              code: 'card_declined',
              message: 'Your card was declined'
            }
          }
        }
      };

      await request(app)
        .post('/payments/webhooks/stripe')
        .set('Stripe-Signature', 'valid_signature')
        .send(webhookPayload)
        .expect(200);

      const updatedTransaction = await TransactionModel.findById(transaction._id);
      expect(updatedTransaction.status).toBe('failed');
      expect(updatedTransaction.errorCode).toBe('card_declined');
      expect(updatedTransaction.errorMessage).toBe('Your card was declined');
    });

    it('should reject invalid signature', async () => {
      const webhookPayload = {
        id: 'evt_test_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_webhook_123' } }
      };

      const response = await request(app)
        .post('/payments/webhooks/stripe')
        .set('Stripe-Signature', 'invalid_signature')
        .send(webhookPayload)
        .expect(400);

      expect(response.body.code).toBe('invalid_signature');
    });

    it('should handle webhook idempotency (no duplicate side-effects)', async () => {
      const webhookPayload = {
        id: 'evt_idempotent_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_webhook_123',
            status: 'succeeded'
          }
        }
      };

      // First webhook call
      await request(app)
        .post('/payments/webhooks/stripe')
        .set('Stripe-Signature', 'valid_signature')
        .send(webhookPayload)
        .expect(200);

      const firstUpdate = await TransactionModel.findById(transaction._id);
      const firstUpdatedAt = firstUpdate.updatedAt;

      // Wait a bit to ensure timestamp would change if updated
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second webhook call (duplicate)
      await request(app)
        .post('/payments/webhooks/stripe')
        .set('Stripe-Signature', 'valid_signature')
        .send(webhookPayload)
        .expect(200);

      const secondUpdate = await TransactionModel.findById(transaction._id);
      
      // Verify no duplicate processing (updatedAt unchanged)
      expect(secondUpdate.updatedAt.getTime()).toBe(firstUpdatedAt.getTime());
      expect(secondUpdate.metadata.lastEventId).toBe('evt_idempotent_1');
    });

    it('should handle unknown payment intent gracefully', async () => {
      const webhookPayload = {
        id: 'evt_unknown_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_unknown_intent',
            status: 'succeeded'
          }
        }
      };

      // Should return 200 (not 404) to prevent Stripe retries
      await request(app)
        .post('/payments/webhooks/stripe')
        .set('Stripe-Signature', 'valid_signature')
        .send(webhookPayload)
        .expect(200);
    });

    it('should ignore unsupported event types', async () => {
      const webhookPayload = {
        id: 'evt_unsupported_1',
        type: 'customer.created', // Unsupported type
        data: {
          object: {
            id: 'cus_123'
          }
        }
      };

      await request(app)
        .post('/payments/webhooks/stripe')
        .set('Stripe-Signature', 'valid_signature')
        .send(webhookPayload)
        .expect(200);
    });
  });

  // ============================================
  // US-4.1.4: GET TRANSACTIONS
  // ============================================

  describe('GET /passengers/transactions', () => {
    let succeededTransaction;
    let failedTransaction;
    let processingTransaction;

    beforeEach(async () => {
      // Create multiple transactions for filtering tests
      succeededTransaction = await TransactionModel.create({
        bookingId: acceptedBooking._id,
        tripId: tripOffer._id,
        passengerId: passengerUser._id,
        driverId: driverUser._id,
        amount: 10000,
        currency: 'COP',
        seats: 2,
        pricePerSeat: 5000,
        status: 'succeeded',
        provider: 'stripe',
        providerPaymentIntentId: 'pi_succeeded_1',
        processedAt: new Date()
      });

      failedTransaction = await TransactionModel.create({
        bookingId: acceptedBooking._id,
        tripId: tripOffer._id,
        passengerId: passengerUser._id,
        driverId: driverUser._id,
        amount: 10000,
        currency: 'COP',
        seats: 2,
        pricePerSeat: 5000,
        status: 'failed',
        provider: 'stripe',
        providerPaymentIntentId: 'pi_failed_1',
        errorCode: 'card_declined'
      });

      processingTransaction = await TransactionModel.create({
        bookingId: acceptedBooking._id,
        tripId: tripOffer._id,
        passengerId: passengerUser._id,
        driverId: driverUser._id,
        amount: 10000,
        currency: 'COP',
        seats: 2,
        pricePerSeat: 5000,
        status: 'processing',
        provider: 'stripe',
        providerPaymentIntentId: 'pi_processing_1'
      });
    });

    it('should list all transactions for authenticated passenger', async () => {
      const response = await request(app)
        .get('/passengers/transactions')
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(200);

      expect(response.body).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: succeededTransaction._id.toString(),
            status: 'succeeded'
          }),
          expect.objectContaining({
            id: failedTransaction._id.toString(),
            status: 'failed'
          }),
          expect.objectContaining({
            id: processingTransaction._id.toString(),
            status: 'processing'
          })
        ]),
        page: 1,
        pageSize: 10,
        total: 3
      });

      // Verify clientSecret is NOT included
      response.body.items.forEach(item => {
        expect(item.clientSecret).toBeUndefined();
      });
    });

    it('should filter by status (single)', async () => {
      const response = await request(app)
        .get('/passengers/transactions')
        .query({ status: 'succeeded' })
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].status).toBe('succeeded');
      expect(response.body.total).toBe(1);
    });

    it('should filter by status (multiple)', async () => {
      const response = await request(app)
        .get('/passengers/transactions')
        .query({ status: ['succeeded', 'failed'] })
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.total).toBe(2);
      
      const statuses = response.body.items.map(item => item.status);
      expect(statuses).toContain('succeeded');
      expect(statuses).toContain('failed');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/passengers/transactions')
        .query({ page: 1, pageSize: 2 })
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(2);
      expect(response.body.total).toBe(3);
      expect(response.body.totalPages).toBe(2);
    });

    it('should sort by createdAt descending (newest first)', async () => {
      const response = await request(app)
        .get('/passengers/transactions')
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(200);

      // processingTransaction was created last, should be first
      expect(response.body.items[0].id).toBe(processingTransaction._id.toString());
    });

    it('should only return transactions for authenticated passenger', async () => {
      // Create another passenger with transactions
      const otherPassenger = await createTestUser({
        fullName: 'Other Passenger',
        corporateEmail: 'other@unisabana.edu.co',
        role: 'passenger'
      });

      await TransactionModel.create({
        bookingId: acceptedBooking._id,
        tripId: tripOffer._id,
        passengerId: otherPassenger._id,
        driverId: driverUser._id,
        amount: 5000,
        currency: 'COP',
        seats: 1,
        pricePerSeat: 5000,
        status: 'succeeded',
        provider: 'stripe',
        providerPaymentIntentId: 'pi_other_passenger'
      });

      const response = await request(app)
        .get('/passengers/transactions')
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(200);

      // Should only see own transactions (3), not other passenger's
      expect(response.body.total).toBe(3);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/passengers/transactions')
        .expect(401);
    });

    it('should require passenger role', async () => {
      await request(app)
        .get('/passengers/transactions')
        .set('Cookie', [`access_token=${driverToken}`])
        .expect(403);
    });

    it('should validate query parameters', async () => {
      const response = await request(app)
        .get('/passengers/transactions')
        .query({ status: 'invalid_status' })
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(400);

      expect(response.body.code).toBe('invalid_schema');
    });

    it('should validate pagination parameters', async () => {
      const response = await request(app)
        .get('/passengers/transactions')
        .query({ page: 0, pageSize: 101 })
        .set('Cookie', [`access_token=${passengerToken}`])
        .expect(400);

      expect(response.body.code).toBe('invalid_schema');
    });
  });
});
