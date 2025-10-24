/**
 * UpdateVehicleDto - Data Transfer Object for vehicle updates
 * Allows partial updates to vehicle data
 */
class UpdateVehicleDto {
  constructor({
    brand,
    model,
    capacity,
    vehiclePhotoUrl,
    soatPhotoUrl
  }) {
    if (brand !== undefined) this.brand = brand?.trim();
    if (model !== undefined) this.model = model?.trim();
    if (capacity !== undefined) this.capacity = capacity;
    if (vehiclePhotoUrl !== undefined) this.vehiclePhotoUrl = vehiclePhotoUrl;
    if (soatPhotoUrl !== undefined) this.soatPhotoUrl = soatPhotoUrl;
  }

  /**
   * Create DTO from request body (PATCH semantics - partial updates)
   * @param {Object} body - Request body
   * @returns {UpdateVehicleDto} - DTO instance
   */
  static fromRequest(body) {
    return new UpdateVehicleDto({
      brand: body.brand,
      model: body.model,
      capacity: body.capacity ? parseInt(body.capacity) : undefined,
      vehiclePhotoUrl: body.vehiclePhotoUrl,
      soatPhotoUrl: body.soatPhotoUrl
    });
  }

  /**
   * Create DTO from multipart/form-data request
   * @param {Object} fields - Form fields from request body
   * @param {Object} files - Uploaded files { vehiclePhoto, soatPhoto }
   * @returns {UpdateVehicleDto} - DTO instance
   */
  static fromMultipart(fields, files) {
    const vehiclePhotoUrl = files?.vehiclePhoto ? `/uploads/vehicles/${files.vehiclePhoto.filename}` : undefined;
    const soatPhotoUrl = files?.soatPhoto ? `/uploads/vehicles/${files.soatPhoto.filename}` : undefined;

    return new UpdateVehicleDto({
      brand: fields.brand,
      model: fields.model,
      capacity: fields.capacity ? parseInt(fields.capacity) : undefined,
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

    // Brand validation (if provided)
    if (this.brand !== undefined && (this.brand.length < 2 || this.brand.length > 60)) {
      errors.push({ field: 'brand', issue: 'Brand must be between 2 and 60 characters' });
    }

    // Model validation (if provided)
    if (this.model !== undefined && (this.model.length < 1 || this.model.length > 60)) {
      errors.push({ field: 'model', issue: 'Model must be between 1 and 60 characters' });
    }

    // Capacity validation (if provided)
    if (this.capacity !== undefined && (this.capacity < 1 || this.capacity > 20)) {
      errors.push({ field: 'capacity', issue: 'Capacity must be between 1 and 20 passengers' });
    }

    if (errors.length > 0) {
      const ValidationError = require('../errors/ValidationError');
      throw new ValidationError('Vehicle update validation failed', 'invalid_vehicle_data', errors);
    }
  }

  /**
   * Convert to plain object for database update
   * @returns {Object} - Plain object with only defined fields
   */
  toObject() {
    const obj = {};
    if (this.brand !== undefined) obj.brand = this.brand;
    if (this.model !== undefined) obj.model = this.model;
    if (this.capacity !== undefined) obj.capacity = this.capacity;
    if (this.vehiclePhotoUrl !== undefined) obj.vehiclePhotoUrl = this.vehiclePhotoUrl;
    if (this.soatPhotoUrl !== undefined) obj.soatPhotoUrl = this.soatPhotoUrl;
    return obj;
  }
}

module.exports = UpdateVehicleDto;

