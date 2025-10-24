/**
 * Payment Provider Error (US-4.1.1)
 * 
 * Thrown when the payment provider (Stripe) returns an error.
 * 
 * HTTP Status: 500 Internal Server Error
 * Error Code: payment_provider_error
 */

const DomainError = require('./DomainError');

class PaymentProviderError extends DomainError {
  constructor(message = 'Payment provider error occurred', details = {}) {
    super(message, 500, 'payment_provider_error', details);
  }
}

module.exports = PaymentProviderError;
