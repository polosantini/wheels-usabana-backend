/**
 * Booking Already Paid Error (US-4.1.1)
 * 
 * Thrown when attempting to create a payment intent for a booking
 * that has already been successfully paid.
 * 
 * HTTP Status: 409 Conflict
 * Error Code: booking_already_paid
 */

const DomainError = require('./DomainError');

class BookingAlreadyPaidError extends DomainError {
  constructor(message = 'Booking has already been paid', details = {}) {
    super(message, 409, 'booking_already_paid', details);
  }
}

module.exports = BookingAlreadyPaidError;
