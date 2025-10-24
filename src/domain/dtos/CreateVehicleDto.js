/**
 * CreateVehicleDto - Data Transfer Object for vehicle creation
 * Validates and sanitizes vehicle creation data
 */
class CreateVehicleDto {
  constructor({
    driverId,
    plate,
    brand,
    model,
    capacity,
    vehiclePhotoUrl = null,
    soatPhotoUrl = null
  }) {
    this.driverId = driverId;
    this.plate = plate?.toUpperCase().trim();
    this.brand = brand?.trim();
    this.model = model?.trim();
    this.capacity = capacity;
    this.vehiclePhotoUrl = vehiclePhotoUrl;
    this.soatPhotoUrl = soatPhotoUrl;
  }

  /**
   * Create DTO from request body
   * @param {Object} body - Request body
   * @param {string} driverId - Driver ID from authentication
   * @returns {CreateVehicleDto} - DTO instance
   */
  static fromRequest(body, driverId) {
    return new CreateVehicleDto({
      driverId,
      plate: body.plate,
      brand: body.brand,
      model: body.model,
      capacity: parseInt(body.capacity),
      vehiclePhotoUrl: body.vehiclePhotoUrl || null,
      soatPhotoUrl: body.soatPhotoUrl || null
    });
  }

  /**
   * Create DTO from multipart/form-data request
   * @param {Object} fields - Form fields from request body
   * @param {Object} files - Uploaded files { vehiclePhoto, soatPhoto }
   * @param {string} driverId - Driver ID from authentication
   * @returns {CreateVehicleDto} - DTO instance
   */
  static fromMultipart(fields, files, driverId) {
    const vehiclePhotoUrl = files?.vehiclePhoto ? `/uploads/vehicles/${files.vehiclePhoto.filename}` : null;
    const soatPhotoUrl = files?.soatPhoto ? `/uploads/vehicles/${files.soatPhoto.filename}` : null;

    return new CreateVehicleDto({
      driverId,
      plate: fields.plate,
      brand: fields.brand,
      model: fields.model,
      capacity: parseInt(fields.capacity),
      vehiclePhotoUrl,
      soatPhotoUrl
    });
  }

  /**
   * Validate DTO data
   * @throws {ValidationError} - If validation fails
   */
  validate() {
    const errors = [];

    // Required fields
    if (!this.driverId) errors.push({ field: 'driverId', issue: 'Driver ID is required' });
    if (!this.plate) errors.push({ field: 'plate', issue: 'Plate is required' });
    if (!this.brand) errors.push({ field: 'brand', issue: 'Brand is required' });
    if (!this.model) errors.push({ field: 'model', issue: 'Model is required' });
    if (!this.capacity) errors.push({ field: 'capacity', issue: 'Capacity is required' });

    // Plate format validation
    if (this.plate && !/^[A-Z]{3}[0-9]{3}$/.test(this.plate)) {
      errors.push({ field: 'plate', issue: 'Plate must be in format ABC123 (3 letters, 3 numbers)' });
    }

    // Brand validation
    if (this.brand && (this.brand.length < 2 || this.brand.length > 60)) {
      errors.push({ field: 'brand', issue: 'Brand must be between 2 and 60 characters' });
    }

    // Model validation
    if (this.model && (this.model.length < 1 || this.model.length > 60)) {
      errors.push({ field: 'model', issue: 'Model must be between 1 and 60 characters' });
    }

    // Capacity validation
    if (this.capacity && (this.capacity < 1 || this.capacity > 20)) {
      errors.push({ field: 'capacity', issue: 'Capacity must be between 1 and 20 passengers' });
    }

    if (errors.length > 0) {
      const ValidationError = require('../errors/ValidationError');
      throw new ValidationError('Vehicle creation validation failed', 'invalid_vehicle_data', errors);
    }
  }

  /**
   * Convert to plain object for database storage
   * @returns {Object} - Plain object
   */
  toObject() {
    return {
      driverId: this.driverId,
      plate: this.plate,
      brand: this.brand,
      model: this.model,
      capacity: this.capacity,
      vehiclePhotoUrl: this.vehiclePhotoUrl,
      soatPhotoUrl: this.soatPhotoUrl
    };
  }
}

module.exports = CreateVehicleDto;

