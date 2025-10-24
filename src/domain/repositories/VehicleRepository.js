/**
 * Abstract VehicleRepository interface
 * Defines contract for vehicle data access
 */
class VehicleRepository {
  /**
   * Create a new vehicle
   * @param {Object} vehicleData - Vehicle data
   * @returns {Promise<Vehicle>} - Created vehicle
   * @throws {OneVehicleRuleError} - If driver already has a vehicle
   * @throws {DuplicatePlateError} - If plate already exists
   */
  async create(vehicleData) {
    throw new Error('Method not implemented');
  }

  /**
   * Find vehicle by driver ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<Vehicle|null>} - Vehicle or null
   */
  async findByDriverId(driverId) {
    throw new Error('Method not implemented');
  }

  /**
   * Find vehicle by plate
   * @param {string} plate - Vehicle plate
   * @returns {Promise<Vehicle|null>} - Vehicle or null
   */
  async findByPlate(plate) {
    throw new Error('Method not implemented');
  }

  /**
   * Update vehicle by driver ID
   * @param {string} driverId - Driver ID
   * @param {Object} updates - Update data
   * @returns {Promise<Vehicle|null>} - Updated vehicle or null
   */
  async updateByDriverId(driverId, updates) {
    throw new Error('Method not implemented');
  }

  /**
   * Check if driver has a vehicle
   * @param {string} driverId - Driver ID
   * @returns {Promise<boolean>} - True if driver has vehicle
   */
  async driverHasVehicle(driverId) {
    throw new Error('Method not implemented');
  }

  /**
   * Check if plate exists
   * @param {string} plate - Vehicle plate
   * @param {string} excludeId - Vehicle ID to exclude from check
   * @returns {Promise<boolean>} - True if plate exists
   */
  async plateExists(plate, excludeId = null) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete vehicle by driver ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<boolean>} - True if deleted
   */
  async deleteByDriverId(driverId) {
    throw new Error('Method not implemented');
  }

  /**
   * Get vehicle count by driver ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<number>} - Vehicle count
   */
  async countByDriverId(driverId) {
    throw new Error('Method not implemented');
  }
}

module.exports = VehicleRepository;

