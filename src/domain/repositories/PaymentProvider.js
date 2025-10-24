/**
 * Payment Provider Interface (US-4.1.1)
 * 
 * Abstract adapter for payment provider integrations (e.g., Stripe).
 * Implementations must provide concrete provider-specific logic.
 * 
 * Design Pattern: Adapter Pattern
 * - Isolates payment provider implementation details
 * - Allows swapping providers without changing domain/service logic
 * - Centralizes provider-specific error handling
 */

class PaymentProvider {
  /**
   * Create a payment intent with the provider
   * 
   * @param {Object} params
   * @param {number} params.amount - Amount in smallest currency unit (e.g., cents)
   * @param {string} params.currency - ISO 4217 currency code (e.g., 'COP', 'USD')
   * @param {Object} [params.metadata] - Additional metadata to attach
   * @returns {Promise<{paymentIntentId: string, clientSecret: string}>}
   * @throws {PaymentProviderError} If provider API fails
   */
  async createPaymentIntent({ amount, currency, metadata }) {
    throw new Error('Method not implemented: createPaymentIntent');
  }

  /**
   * Retrieve a payment intent from the provider
   * 
   * @param {string} paymentIntentId - Provider's payment intent ID
   * @returns {Promise<Object>} Payment intent details
   * @throws {PaymentProviderError} If provider API fails
   */
  async retrievePaymentIntent(paymentIntentId) {
    throw new Error('Method not implemented: retrievePaymentIntent');
  }

  /**
   * Cancel a payment intent with the provider
   * Used when passenger cancels booking before payment
   * 
   * @param {string} paymentIntentId - Provider's payment intent ID
   * @returns {Promise<Object>} Canceled payment intent
   * @throws {PaymentProviderError} If provider API fails
   */
  async cancelPaymentIntent(paymentIntentId) {
    throw new Error('Method not implemented: cancelPaymentIntent');
  }

  /**
   * Parse and verify webhook event from provider
   * 
   * @param {Object} headers - HTTP request headers
   * @param {string} rawBody - Raw request body (required for signature verification)
   * @returns {Promise<{eventId: string, type: string, data: Object}>} Parsed event
   * @throws {PaymentProviderError} If signature verification fails
   */
  async parseAndVerifyWebhook(headers, rawBody) {
    throw new Error('Method not implemented: parseAndVerifyWebhook');
  }

  /**
   * Get provider name
   * 
   * @returns {string} Provider identifier (e.g., 'stripe')
   */
  getProviderName() {
    throw new Error('Method not implemented: getProviderName');
  }
}

module.exports = PaymentProvider;
