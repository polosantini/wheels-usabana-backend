/**
 * TripOffer Repository Interface
 * Domain layer contract for trip offer data access
 */
class TripOfferRepository {
  /**
   * Create a new trip offer
   * @param {Object} tripData - Trip offer data
   * @returns {Promise<TripOffer>}
   */
  async create(tripData) {
    throw new Error('Method not implemented');
  }

  /**
   * Find trip offer by ID
   * @param {string} tripId - Trip offer ID
   * @returns {Promise<TripOffer|null>}
   */
  async findById(tripId) {
    throw new Error('Method not implemented');
  }

  /**
   * Find all trip offers by driver ID
   * @param {string} driverId - Driver user ID
   * @param {Object} filters - Optional filters (status, dateRange)
   * @returns {Promise<TripOffer[]>}
   */
  async findByDriverId(driverId, filters = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Find overlapping published trips for a driver
   * @param {string} driverId - Driver user ID
   * @param {Date} departureAt - Trip departure time
   * @param {Date} estimatedArrivalAt - Trip arrival time
   * @param {string} excludeTripId - Trip ID to exclude (for updates)
   * @returns {Promise<TripOffer[]>}
   */
  async findOverlappingTrips(driverId, departureAt, estimatedArrivalAt, excludeTripId = null) {
    throw new Error('Method not implemented');
  }

  /**
   * Update trip offer
   * @param {string} tripId - Trip offer ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<TripOffer>}
   */
  async update(tripId, updates) {
    throw new Error('Method not implemented');
  }

  /**
   * Soft delete (cancel) trip offer
   * @param {string} tripId - Trip offer ID
   * @returns {Promise<TripOffer>}
   */
  async cancel(tripId) {
    throw new Error('Method not implemented');
  }

  /**
   * Find upcoming published trips by driver
   * @param {string} driverId - Driver user ID
   * @returns {Promise<TripOffer[]>}
   */
  async findUpcomingByDriver(driverId) {
    throw new Error('Method not implemented');
  }

  /**
   * Count trips by driver and status
   * @param {string} driverId - Driver user ID
   * @param {string} status - Trip status
   * @returns {Promise<number>}
   */
  async countByDriverAndStatus(driverId, status) {
    throw new Error('Method not implemented');
  }
}

module.exports = TripOfferRepository;
