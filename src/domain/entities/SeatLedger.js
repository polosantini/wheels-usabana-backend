/**
 * SeatLedger Domain Entity
 * 
 * Tracks allocated seats per trip for atomic capacity enforcement.
 * Encapsulates business logic for seat allocation and availability.
 */

class SeatLedger {
  constructor({
    id,
    tripId,
    allocatedSeats = 0,
    bookedPassengers = [],
    createdAt = new Date(),
    updatedAt = new Date()
  }) {
    this.id = id;
    this.tripId = tripId;
    this.allocatedSeats = allocatedSeats;
    this.bookedPassengers = bookedPassengers; // Array of { bookingRequestId, passengerId, seats, acceptedAt }
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;

    this.validate();
  }

  /**
   * Validate seat ledger invariants
   */
  validate() {
    if (!this.tripId) {
      throw new Error('Trip ID is required');
    }

    if (!Number.isInteger(this.allocatedSeats) || this.allocatedSeats < 0) {
      throw new Error('Allocated seats must be a non-negative integer');
    }
  }

  /**
   * Check if there's capacity to allocate seats
   * @param {number} totalSeats - Total seats available on the trip
   * @param {number} requestedSeats - Number of seats to allocate
   * @returns {boolean} True if allocation is possible
   */
  hasCapacity(totalSeats, requestedSeats = 1) {
    return this.allocatedSeats + requestedSeats <= totalSeats;
  }

  /**
   * Get remaining available seats
   * @param {number} totalSeats - Total seats available on the trip
   * @returns {number} Number of remaining seats
   */
  getRemainingSeats(totalSeats) {
    return Math.max(0, totalSeats - this.allocatedSeats);
  }

  /**
   * Calculate utilization percentage
   * @param {number} totalSeats - Total seats available on the trip
   * @returns {number} Utilization percentage (0-100)
   */
  getUtilizationPercentage(totalSeats) {
    if (totalSeats === 0) return 0;
    return Math.round((this.allocatedSeats / totalSeats) * 100);
  }

  /**
   * Check if trip is fully booked
   * @param {number} totalSeats - Total seats available on the trip
   * @returns {boolean} True if no seats available
   */
  isFullyBooked(totalSeats) {
    return this.allocatedSeats >= totalSeats;
  }

  /**
   * Create a plain object representation (for database persistence)
   */
  toObject() {
    return {
      id: this.id,
      tripId: this.tripId,
      allocatedSeats: this.allocatedSeats,
      bookedPassengers: this.bookedPassengers,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = SeatLedger;
