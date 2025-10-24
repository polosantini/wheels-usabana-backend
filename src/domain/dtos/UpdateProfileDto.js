// Import single source of truth for allow-list validation
const { ALLOWED_FIELDS, IMMUTABLE_FIELDS } = require('../../api/middlewares/validateAllowList');

/**
 * DTO para actualización parcial de perfil de usuario
 * 
 * SINGLE SOURCE OF TRUTH: Las listas de campos están definidas en validateAllowList middleware
 * 
 * ALLOW-LIST (campos permitidos):
 * - firstName
 * - lastName
 * - phone
 * - profilePhoto (file upload)
 * 
 * IMMUTABLE (campos prohibidos, generan 403):
 * - corporateEmail
 * - universityId
 * - role
 * - id
 * - password (tiene su propio endpoint)
 */
class UpdateProfileDto {
  constructor({ firstName, lastName, phone, profilePhotoUrl } = {}) {
    this.firstName = firstName;
    this.lastName = lastName;
    this.phone = phone;
    this.profilePhotoUrl = profilePhotoUrl;
  }

  /**
   * Create DTO from JSON request body
   * @param {Object} body - Request body
   * @returns {UpdateProfileDto}
   */
  static fromRequest(body) {
    return new UpdateProfileDto({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone
    });
  }

  /**
   * Create DTO from multipart/form-data request
   * Handles both text fields and file upload
   * 
   * @param {Object} fields - Form fields from request body
   * @param {Object} file - Uploaded file from multer (req.file)
   * @returns {UpdateProfileDto}
   */
  static fromMultipart(fields, file) {
    const profilePhotoUrl = file ? `/uploads/profiles/${file.filename}` : undefined;

    return new UpdateProfileDto({
      firstName: fields.firstName,
      lastName: fields.lastName,
      phone: fields.phone,
      profilePhotoUrl
    });
  }

  /**
   * Check if any immutable fields are present in the request
   * Uses SINGLE SOURCE OF TRUTH from validateAllowList middleware
   * 
   * @param {Object} body - Request body to check
   * @returns {string|null} - First immutable field found, or null
   */
  static checkImmutableFields(body) {
    for (const field of IMMUTABLE_FIELDS) {
      if (field in body) {
        return field;
      }
    }
    
    return null;
  }

  /**
   * Get all immutable fields present in the request
   * Used for detailed error reporting
   * 
   * @param {Object} body - Request body to check
   * @returns {string[]} - Array of immutable fields found
   */
  static getImmutableFields(body) {
    return Object.keys(body).filter(key => IMMUTABLE_FIELDS.includes(key));
  }

  /**
   * Check if any unknown fields are present in the request
   * Unknown = not in ALLOWED_FIELDS and not in IMMUTABLE_FIELDS
   * 
   * @param {Object} body - Request body to check
   * @returns {string[]} - Array of unknown fields found
   */
  static getUnknownFields(body) {
    const allKnownFields = [...ALLOWED_FIELDS, ...IMMUTABLE_FIELDS];
    return Object.keys(body).filter(key => !allKnownFields.includes(key));
  }

  /**
   * Convert DTO to plain object, removing undefined fields
   * Only includes fields that were actually provided
   * 
   * @returns {Object}
   */
  toObject() {
    const obj = {};
    
    if (this.firstName !== undefined) obj.firstName = this.firstName;
    if (this.lastName !== undefined) obj.lastName = this.lastName;
    if (this.phone !== undefined) obj.phone = this.phone;
    if (this.profilePhotoUrl !== undefined) obj.profilePhoto = this.profilePhotoUrl;
    
    return obj;
  }

  /**
   * Check if DTO has any fields to update
   * @returns {boolean}
   */
  isEmpty() {
    return Object.keys(this.toObject()).length === 0;
  }
}

module.exports = UpdateProfileDto;

