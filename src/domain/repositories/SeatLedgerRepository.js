/**
 * SeatLedger Repository Interface
 * Domain layer contract for seat ledger data access
 */
class SeatLedgerRepository {
  /**
   * Get or create ledger for a trip
   * @param {string} tripId - Trip ID
   * @returns {Promise<SeatLedger>}
   */
  async getOrCreate(tripId) {
    throw new Error('Method not implemented');
  }

  /**
   * Get ledger by trip ID
   * @param {string} tripId - Trip ID
   * @returns {Promise<SeatLedger|null>}
   */
  async findByTripId(tripId) {
    throw new Error('Method not implemented');
  }

  /**
   * Atomically allocate seats (race-safe)
   * Uses findOneAndUpdate with conditional guards
   * 
   * @param {string} tripId - Trip ID
   * @param {number} totalSeats - Total seats available on trip
   * @param {number} requestedSeats - Number of seats to allocate
   * @param {string} bookingRequestId - Booking request ID
   * @param {string} passengerId - Passenger ID
   * @returns {Promise<SeatLedger|null>} Updated ledger or null if capacity exceeded
   */
  async allocateSeats(tripId, totalSeats, requestedSeats, bookingRequestId, passengerId) {
    throw new Error('Method not implemented');
  }

  /**
   * Deallocate seats (for cancellations - future use)
   * @param {string} tripId - Trip ID
   * @param {string} bookingRequestId - Booking request ID
   * @param {number} seats - Number of seats to deallocate
   * @returns {Promise<SeatLedger|null>}
   */
  async deallocateSeats(tripId, bookingRequestId, seats) {
    throw new Error('Method not implemented');
  }
}

module.exports = SeatLedgerRepository;
