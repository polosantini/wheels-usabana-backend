/**
 * Invalid Booking State Error (US-4.1.1)
 * 
 * Thrown when attempting to create a payment intent for a booking
 * that is not in the 'accepted' state.
 * 
 * HTTP Status: 409 Conflict
 * Error Code: invalid_booking_state
 */

const DomainError = require('./DomainError');

class InvalidBookingStateError extends DomainError {
  constructor(message = 'Booking must be in accepted state to create payment', details = {}) {
    super(message, 409, 'invalid_booking_state', details);
  }
}

module.exports = InvalidBookingStateError;
