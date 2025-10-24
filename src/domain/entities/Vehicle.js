/**
 * Vehicle Entity
 * Represents a vehicle owned by a driver
 * Enforces one-vehicle-per-driver business rule
 */
class Vehicle {
  constructor({
    id,
    driverId,
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
    this.driverId = driverId;
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
   * Create Vehicle from MongoDB document
   * @param {Object} doc - MongoDB document
   * @returns {Vehicle} - Vehicle entity
   */
  static fromDocument(doc) {
    return new Vehicle({
      id: doc._id.toString(),
      driverId: doc.driverId.toString(),
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
   * Check if vehicle has photos
   * @returns {boolean} - True if vehicle has photos
   */
  hasPhotos() {
    return !!(this.vehiclePhotoUrl || this.soatPhotoUrl);
  }

  /**
   * Get vehicle display name
   * @returns {string} - Formatted vehicle name
   */
  getDisplayName() {
    return `${this.brand} ${this.model}`;
  }

  /**
   * Check if vehicle is complete (has all required data)
   * @returns {boolean} - True if vehicle is complete
   */
  isComplete() {
    return !!(this.driverId && this.plate && this.brand && this.model && this.capacity);
  }
}

module.exports = Vehicle;

