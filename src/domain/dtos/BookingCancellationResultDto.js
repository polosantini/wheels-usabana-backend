/**
 * BookingCancellationResultDto
 * 
 * Data Transfer Object for booking cancellation effects.
 * Provides summary of seat deallocation and refund status.
 * 
 * Used in: POST /passengers/bookings/:bookingId/cancel (US-3.4.3)
 */

class BookingCancellationResultDto {
  constructor({
    id,
    status,
    effects
  }) {
    this.id = id;
    this.status = status;
    this.effects = {
      ledgerReleased: effects.ledgerReleased || 0,
      refundCreated: effects.refundCreated || false
    };
  }

  /**
   * Create DTO from cancellation result
   * 
   * @param {string} bookingId - Canceled booking ID
   * @param {string} bookingStatus - Final booking status (should be 'canceled_by_passenger')
   * @param {Object} cancellationEffects - Summary of cancellation operations
   * @param {number} cancellationEffects.ledgerReleased - Count of seats deallocated (0 or booking.seats)
   * @param {boolean} cancellationEffects.refundCreated - Whether RefundIntent was created (US-4.2)
   * @returns {BookingCancellationResultDto}
   */
  static fromCancellationResult(bookingId, bookingStatus, cancellationEffects) {
    return new BookingCancellationResultDto({
      id: bookingId,
      status: bookingStatus,
      effects: cancellationEffects
    });
  }
}

module.exports = BookingCancellationResultDto;
