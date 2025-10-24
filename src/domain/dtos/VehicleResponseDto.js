/**
 * VehicleResponseDto - Data Transfer Object for vehicle responses
 * Hides internal fields and provides consistent API shape
 */
class VehicleResponseDto {
  constructor({
    id,
    plate,
    brand,
    model,
    capacity,
    vehiclePhotoUrl = null,
    soatPhotoUrl = null,
    createdAt,
    updatedAt
  }) {
    this.id = id;
    this.plate = plate;
    this.brand = brand;
    this.model = model;
    this.capacity = capacity;
    this.vehiclePhotoUrl = vehiclePhotoUrl;
    this.soatPhotoUrl = soatPhotoUrl;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  /**
   * Create DTO from Vehicle entity
   * @param {Vehicle} vehicle - Vehicle entity
   * @returns {VehicleResponseDto} - DTO instance
   */
  static fromEntity(vehicle) {
    return new VehicleResponseDto({
      id: vehicle.id,
      plate: vehicle.plate,
      brand: vehicle.brand,
      model: vehicle.model,
      capacity: vehicle.capacity,
      vehiclePhotoUrl: vehicle.vehiclePhotoUrl,
      soatPhotoUrl: vehicle.soatPhotoUrl,
      createdAt: vehicle.createdAt,
      updatedAt: vehicle.updatedAt
    });
  }

  /**
   * Create DTO from MongoDB document
   * @param {Object} doc - MongoDB document
   * @returns {VehicleResponseDto} - DTO instance
   */
  static fromDocument(doc) {
    return new VehicleResponseDto({
      id: doc._id.toString(),
      plate: doc.plate,
      brand: doc.brand,
      model: doc.model,
      capacity: doc.capacity,
      vehiclePhotoUrl: doc.vehiclePhotoUrl,
      soatPhotoUrl: doc.soatPhotoUrl,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  }

  /**
   * Get vehicle display name
   * @returns {string} - Formatted vehicle name
   */
  getDisplayName() {
    return `${this.brand} ${this.model}`;
  }

  /**
   * Check if vehicle has photos
   * @returns {boolean} - True if vehicle has photos
   */
  hasPhotos() {
    return !!(this.vehiclePhotoUrl || this.soatPhotoUrl);
  }
}

module.exports = VehicleResponseDto;

