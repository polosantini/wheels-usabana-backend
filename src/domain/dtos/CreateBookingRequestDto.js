/**
 * CreateBookingRequestDto
 * 
 * Data Transfer Object for creating a new booking request.
 * Validates passenger input before passing to service layer.
 */

class CreateBookingRequestDto {
  constructor({ tripId, seats = 1, note = '' }) {
    this.tripId = tripId;
    this.seats = seats;
    this.note = note;
  }

  /**
   * Validate DTO fields
   * @throws {Error} if validation fails
   */
  validate() {
    const errors = [];

    // Trip ID validation
    if (!this.tripId) {
      errors.push('tripId is required');
    } else if (typeof this.tripId !== 'string') {
      errors.push('tripId must be a string');
    } else if (!/^[a-f\d]{24}$/i.test(this.tripId)) {
      errors.push('tripId must be a valid MongoDB ObjectId');
    }

    // Seats validation
    if (this.seats === undefined || this.seats === null) {
      errors.push('seats is required');
    } else if (!Number.isInteger(this.seats)) {
      errors.push('seats must be an integer');
    } else if (this.seats < 1) {
      errors.push('seats must be at least 1');
    }

    // Note validation (optional)
    if (this.note !== undefined && this.note !== null) {
      if (typeof this.note !== 'string') {
        errors.push('note must be a string');
      } else if (this.note.length > 300) {
        errors.push('note cannot exceed 300 characters');
      }
    }

    if (errors.length > 0) {
      const error = new Error('Validation failed');
      error.code = 'VALIDATION_ERROR';
      error.details = errors;
      throw error;
    }

    return true;
  }

  /**
   * Create DTO from request body
   * @param {Object} body - Express request body
   * @returns {CreateBookingRequestDto}
   */
  static fromRequest(body) {
    return new CreateBookingRequestDto({
      tripId: body.tripId,
      seats: body.seats !== undefined ? Number(body.seats) : 1,
      note: body.note || ''
    });
  }
}

module.exports = CreateBookingRequestDto;

