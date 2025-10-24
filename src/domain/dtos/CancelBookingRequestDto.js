/**
 * CancelBookingRequestDto
 * 
 * Data Transfer Object for passenger-initiated booking cancellation.
 * Supports optional reason for audit trail.
 * 
 * Used in: POST /passengers/bookings/:bookingId/cancel (US-3.4.3)
 */

class CancelBookingRequestDto {
  constructor({ reason = '' }) {
    this.reason = reason?.trim() || '';
  }

  /**
   * Validate cancellation request
   * @returns {string[]} Array of error messages (empty if valid)
   */
  validate() {
    const errors = [];

    if (this.reason && this.reason.length > 500) {
      errors.push('Cancellation reason cannot exceed 500 characters');
    }

    return errors;
  }

  /**
   * Create DTO from request body
   * @param {Object} body - Request body
   * @returns {CancelBookingRequestDto}
   */
  static fromRequest(body = {}) {
    return new CancelBookingRequestDto({
      reason: body.reason
    });
  }
}

module.exports = CancelBookingRequestDto;
