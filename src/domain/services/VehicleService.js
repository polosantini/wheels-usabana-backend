const MongoVehicleRepository = require('../../infrastructure/repositories/MongoVehicleRepository');
const CreateVehicleDto = require('../dtos/CreateVehicleDto');
const UpdateVehicleDto = require('../dtos/UpdateVehicleDto');
const VehicleResponseDto = require('../dtos/VehicleResponseDto');
const OneVehicleRuleError = require('../errors/OneVehicleRuleError');
const DuplicatePlateError = require('../errors/DuplicatePlateError');

/**
 * VehicleService - Business logic for vehicle operations
 * Enforces one-vehicle-per-driver business rule
 */
class VehicleService {
  constructor() {
    this.vehicleRepository = new MongoVehicleRepository();
  }

  /**
   * Create a new vehicle for a driver
   * @param {CreateVehicleDto} createVehicleDto - Vehicle creation DTO
   * @returns {Promise<VehicleResponseDto>} - Created vehicle response
   * @throws {OneVehicleRuleError} - If driver already has a vehicle
   * @throws {DuplicatePlateError} - If plate already exists
   */
  async createVehicle(createVehicleDto) {
    console.log('[VehicleService] Creating vehicle with data:', {
      driverId: createVehicleDto.driverId,
      plate: createVehicleDto.plate,
      brand: createVehicleDto.brand,
      model: createVehicleDto.model,
      capacity: createVehicleDto.capacity
    });

    // Check if driver already has a vehicle
    const hasVehicle = await this.vehicleRepository.driverHasVehicle(createVehicleDto.driverId);
    if (hasVehicle) {
      throw new OneVehicleRuleError(
        'Driver can only have one vehicle',
        'one_vehicle_rule',
        { driverId: createVehicleDto.driverId }
      );
    }

    // Check if plate already exists
    const plateExists = await this.vehicleRepository.plateExists(createVehicleDto.plate);
    if (plateExists) {
      throw new DuplicatePlateError(
        'Vehicle plate already exists',
        'duplicate_plate',
        { plate: createVehicleDto.plate }
      );
    }

    // Create vehicle in repository
    const vehicleData = createVehicleDto.toObject();
    console.log('[VehicleService] Vehicle data to save:', vehicleData);
    const vehicle = await this.vehicleRepository.create(vehicleData);
    console.log('[VehicleService] Vehicle created in repository:', {
      id: vehicle.id,
      plate: vehicle.plate,
      brand: vehicle.brand,
      model: vehicle.model,
      capacity: vehicle.capacity
    });
    
    const responseDto = VehicleResponseDto.fromEntity(vehicle);
    console.log('[VehicleService] Response DTO:', {
      id: responseDto.id,
      plate: responseDto.plate,
      brand: responseDto.brand,
      model: responseDto.model,
      capacity: responseDto.capacity
    });
    
    return responseDto;
  }

  /**
   * Get vehicle by driver ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<VehicleResponseDto|null>} - Vehicle response or null
   */
  async getVehicleByDriverId(driverId) {
    const vehicle = await this.vehicleRepository.findByDriverId(driverId);
    return vehicle ? VehicleResponseDto.fromEntity(vehicle) : null;
  }

  /**
   * Update vehicle by driver ID
   * @param {string} driverId - Driver ID
   * @param {UpdateVehicleDto} updateVehicleDto - Vehicle update DTO
   * @returns {Promise<VehicleResponseDto|null>} - Updated vehicle response or null
   */
  async updateVehicle(driverId, updateVehicleDto) {
    // Check if vehicle exists
    const existingVehicle = await this.vehicleRepository.findByDriverId(driverId);
    if (!existingVehicle) {
      return null;
    }

    // Get update data
    const updateData = updateVehicleDto.toObject();

    // Delete old photos if new ones are provided
    if (updateData.vehiclePhotoUrl && existingVehicle.vehiclePhotoUrl) {
      const fs = require('fs').promises;
      const path = require('path');
      const oldPath = path.join(__dirname, '../../../', existingVehicle.vehiclePhotoUrl);
      try {
        await fs.unlink(oldPath);
      } catch (err) {
        console.error('Error deleting old vehicle photo:', err);
      }
    }

    if (updateData.soatPhotoUrl && existingVehicle.soatPhotoUrl) {
      const fs = require('fs').promises;
      const path = require('path');
      const oldPath = path.join(__dirname, '../../../', existingVehicle.soatPhotoUrl);
      try {
        await fs.unlink(oldPath);
      } catch (err) {
        console.error('Error deleting old SOAT photo:', err);
      }
    }

    // Update vehicle
    const updatedVehicle = await this.vehicleRepository.updateByDriverId(driverId, updateData);
    return updatedVehicle ? VehicleResponseDto.fromEntity(updatedVehicle) : null;
  }

  /**
   * Delete vehicle by driver ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<boolean>} - True if deleted
   */
  async deleteVehicle(driverId) {
    try {
      // Get vehicle to cleanup images
      const vehicle = await this.vehicleRepository.findByDriverId(driverId);
      if (!vehicle) {
        return false;
      }

      // Delete vehicle
      const deleted = await this.vehicleRepository.deleteByDriverId(driverId);

      // Cleanup images after successful deletion
      if (deleted) {
        const fs = require('fs').promises;
        const path = require('path');

        if (vehicle.vehiclePhotoUrl) {
          const photoPath = path.join(__dirname, '../../../', vehicle.vehiclePhotoUrl);
          try {
            await fs.unlink(photoPath);
          } catch (err) {
            console.error('Error deleting vehicle photo:', err);
          }
        }

        if (vehicle.soatPhotoUrl) {
          const soatPath = path.join(__dirname, '../../../', vehicle.soatPhotoUrl);
          try {
            await fs.unlink(soatPath);
          } catch (err) {
            console.error('Error deleting SOAT photo:', err);
          }
        }
      }

      return deleted;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if driver has a vehicle
   * @param {string} driverId - Driver ID
   * @returns {Promise<boolean>} - True if driver has vehicle
   */
  async driverHasVehicle(driverId) {
    return await this.vehicleRepository.driverHasVehicle(driverId);
  }
}

module.exports = VehicleService;

