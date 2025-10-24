/**
 * Webhook Controller (US-4.1.3)
 * 
 * Handles webhook events from payment providers (Stripe).
 * 
 * CRITICAL:
 * - Uses RAW body for signature verification
 * - Must be mounted BEFORE json() body parser
 * - Returns 200 quickly (no long processing)
 * - Idempotent event processing
 */

const PaymentService = require('../../domain/services/PaymentService');
const MongoTransactionRepository = require('../../infrastructure/repositories/MongoTransactionRepository');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const StripePaymentProvider = require('../../infrastructure/payment/StripePaymentProvider');

class WebhookController {
  constructor() {
    // Initialize repositories
    this.transactionRepository = new MongoTransactionRepository();
    this.bookingRequestRepository = new MongoBookingRequestRepository();
    this.tripOfferRepository = new MongoTripOfferRepository();
    this.paymentProvider = new StripePaymentProvider();

    // Initialize service
    this.paymentService = new PaymentService(
      this.transactionRepository,
      this.bookingRequestRepository,
      this.tripOfferRepository,
      this.paymentProvider
    );
  }

  /**
   * Handle Stripe webhook event
   * 
   * POST /payments/webhooks/stripe
   * 
   * Flow:
   * 1. Verify signature using raw body
   * 2. Parse event
   * 3. Process event idempotently
   * 4. Return 200 quickly
   * 
   * @param {Request} req - Express request (with rawBody)
   * @param {Response} res - Express response
   * @param {Function} next - Express next middleware
   */
  async handleStripeWebhook(req, res, next) {
    const correlationId = req.correlationId || 'webhook-' + Date.now();

    try {
      // Get raw body (attached by rawBodyMiddleware)
      const rawBody = req.rawBody;
      if (!rawBody) {
        const error = new Error('Raw body required for webhook signature verification');
        error.code = 'missing_raw_body';
        error.statusCode = 400;
        throw error;
      }

      // Verify signature and parse event
      let event;
      try {
        event = await this.paymentProvider.parseAndVerifyWebhook(
          req.headers,
          rawBody
        );
      } catch (error) {
        // Signature verification failed
        console.error(
          {
            correlationId,
            error: error.message,
            code: error.code
          },
          'Webhook signature verification failed'
        );

        return res.status(400).json({
          code: 'invalid_signature',
          message: 'Webhook signature verification failed'
        });
      }

      // Log webhook received (no PII)
      console.info(
        {
          correlationId,
          eventId: event.eventId,
          eventType: event.type,
          providerPaymentIntentId: event.data.id
        },
        'Webhook event received and verified'
      );

      // Process event idempotently
      const result = await this.paymentService.handleWebhookEvent(event);

      // Log processing result
      console.info(
        {
          correlationId,
          eventId: event.eventId,
          transactionId: result.transactionId,
          alreadyProcessed: result.alreadyProcessed,
          status: result.status
        },
        'Webhook event processed'
      );

      // Return 200 OK quickly
      return res.status(200).json({ ok: true });
    } catch (error) {
      // Log error (no PII)
      console.error(
        {
          correlationId,
          error: error.message,
          code: error.code,
          stack: error.stack
        },
        'Webhook processing error'
      );

      // Always return 200 to prevent retries for application errors
      // Stripe will keep retrying on non-2xx responses
      return res.status(200).json({
        ok: false,
        error: 'Internal processing error (logged for investigation)'
      });
    }
  }
}

module.exports = WebhookController;
