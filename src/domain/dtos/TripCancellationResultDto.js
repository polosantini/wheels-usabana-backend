/**
 * TripCancellationResultDto
 * 
 * Data Transfer Object for trip cancellation cascade effects.
 * Provides summary of affected bookings and refunds triggered.
 * 
 * Used in: DELETE /drivers/trips/:tripId (US-3.4.2)
 */

class TripCancellationResultDto {
  constructor({
    id,
    status,
    effects
  }) {
    this.id = id;
    this.status = status;
    this.effects = {
      declinedAuto: effects.declinedAuto || 0,
      canceledByPlatform: effects.canceledByPlatform || 0,
      refundsCreated: effects.refundsCreated || 0,
      ledgerReleased: effects.ledgerReleased || 0
    };
  }

  /**
   * Create DTO from cancellation result
   * 
   * @param {string} tripId - Canceled trip ID
   * @param {string} tripStatus - Final trip status (should be 'canceled')
   * @param {Object} cascadeEffects - Summary of cascade operations
   * @param {number} cascadeEffects.declinedAuto - Count of pending bookings auto-declined
   * @param {number} cascadeEffects.canceledByPlatform - Count of accepted bookings canceled by platform
   * @param {number} cascadeEffects.refundsCreated - Count of RefundIntents created (US-4.2)
   * @param {number} cascadeEffects.ledgerReleased - Count of seat ledger releases
   * @returns {TripCancellationResultDto}
   */
  static fromCancellationResult(tripId, tripStatus, cascadeEffects) {
    return new TripCancellationResultDto({
      id: tripId,
      status: tripStatus,
      effects: cascadeEffects
    });
  }
}

module.exports = TripCancellationResultDto;
