/**
 * Duplicate Payment Error (US-4.1.1)
 * 
 * Thrown when attempting to create a payment intent for a booking
 * that already has an active or succeeded transaction.
 * 
 * HTTP Status: 409 Conflict
 * Error Code: duplicate_payment
 */

const DomainError = require('./DomainError');

class DuplicatePaymentError extends DomainError {
  constructor(message = 'Booking already has an active or completed payment', details = {}) {
    super(message, 409, 'duplicate_payment', details);
  }
}

module.exports = DuplicatePaymentError;
