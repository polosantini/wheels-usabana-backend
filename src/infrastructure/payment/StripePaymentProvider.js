/**
 * Stripe Payment Provider (US-4.1.1)
 * 
 * Concrete implementation of PaymentProvider for Stripe.
 * 
 * Features:
 * - Create payment intents
 * - Webhook signature verification
 * - Error handling and mapping to domain errors
 * 
 * Environment Variables Required:
 * - STRIPE_SECRET_KEY: Stripe API secret key
 * - STRIPE_WEBHOOK_SECRET: Stripe webhook signing secret
 */

const PaymentProvider = require('../../domain/repositories/PaymentProvider');
const PaymentProviderError = require('../../domain/errors/PaymentProviderError');

class StripePaymentProvider extends PaymentProvider {
  /**
   * @param {Object} [config] - Configuration options
   * @param {string} [config.secretKey] - Stripe secret key (defaults to env var)
   * @param {string} [config.webhookSecret] - Webhook signing secret (defaults to env var)
   */
  constructor(config = {}) {
    super();

    // Lazy-load Stripe SDK (only when needed)
    this.stripe = null;
    this.secretKey = config.secretKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;

    if (!this.secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
    }
  }

  /**
   * Initialize Stripe SDK (lazy initialization)
   * 
   * @private
   */
  _initStripe() {
    if (!this.stripe) {
      const Stripe = require('stripe');
      this.stripe = new Stripe(this.secretKey);
    }
    return this.stripe;
  }

  /**
   * Create a payment intent with Stripe
   * 
   * @param {Object} params
   * @param {number} params.amount - Amount in smallest currency unit
   * @param {string} params.currency - ISO 4217 currency code
   * @param {Object} [params.metadata] - Additional metadata
   * @returns {Promise<{paymentIntentId: string, clientSecret: string}>}
   * @throws {PaymentProviderError} If Stripe API fails
   */
  async createPaymentIntent({ amount, currency, metadata = {} }) {
    const stripe = this._initStripe();

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: currency.toLowerCase(),
        metadata,
        // Automatic payment methods enabled
        automatic_payment_methods: {
          enabled: true
        }
      });

      return {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret
      };
    } catch (error) {
      throw new PaymentProviderError(
        `Stripe payment intent creation failed: ${error.message}`,
        {
          originalError: error.type || error.code,
          amount,
          currency
        }
      );
    }
  }

  /**
   * Retrieve a payment intent from Stripe
   * 
   * @param {string} paymentIntentId - Stripe payment intent ID
   * @returns {Promise<Object>} Payment intent details
   * @throws {PaymentProviderError} If Stripe API fails
   */
  async retrievePaymentIntent(paymentIntentId) {
    const stripe = this._initStripe();

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      throw new PaymentProviderError(
        `Stripe payment intent retrieval failed: ${error.message}`,
        {
          originalError: error.type || error.code,
          paymentIntentId
        }
      );
    }
  }

  /**
   * Cancel a payment intent with Stripe
   * 
   * @param {string} paymentIntentId - Stripe payment intent ID
   * @returns {Promise<Object>} Canceled payment intent
   * @throws {PaymentProviderError} If Stripe API fails
   */
  async cancelPaymentIntent(paymentIntentId) {
    const stripe = this._initStripe();

    try {
      const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      throw new PaymentProviderError(
        `Stripe payment intent cancellation failed: ${error.message}`,
        {
          originalError: error.type || error.code,
          paymentIntentId
        }
      );
    }
  }

  /**
   * Parse and verify webhook event from Stripe
   * 
   * Uses Stripe's signature verification to ensure webhook authenticity.
   * Prevents replay attacks and unauthorized webhook calls.
   * 
   * @param {Object} headers - HTTP request headers
   * @param {string} rawBody - Raw request body (Buffer or string)
   * @returns {Promise<{eventId: string, type: string, data: Object}>}
   * @throws {PaymentProviderError} If signature verification fails
   */
  async parseAndVerifyWebhook(headers, rawBody) {
    const stripe = this._initStripe();

    // Extract Stripe signature header
    const signature = headers['stripe-signature'];
    if (!signature) {
      throw new PaymentProviderError('Missing stripe-signature header', {
        code: 'missing_signature'
      });
    }

    try {
      // Verify webhook signature
      const event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret
      );

      return {
        eventId: event.id,
        type: event.type,
        data: event.data.object
      };
    } catch (error) {
      throw new PaymentProviderError(
        `Webhook signature verification failed: ${error.message}`,
        {
          originalError: error.type || error.code,
          code: 'invalid_signature'
        }
      );
    }
  }

  /**
   * Map Stripe payment intent status to internal transaction status
   * 
   * @param {string} stripeStatus - Stripe payment intent status
   * @returns {string} Internal transaction status
   */
  mapStripeStatus(stripeStatus) {
    const statusMap = {
      'requires_payment_method': 'requires_payment_method',
      'requires_confirmation': 'requires_payment_method',
      'requires_action': 'requires_payment_method',
      'processing': 'processing',
      'requires_capture': 'processing',
      'succeeded': 'succeeded',
      'canceled': 'canceled'
    };

    return statusMap[stripeStatus] || 'failed';
  }

  /**
   * Get provider name
   * 
   * @returns {string} 'stripe'
   */
  getProviderName() {
    return 'stripe';
  }
}

module.exports = StripePaymentProvider;
