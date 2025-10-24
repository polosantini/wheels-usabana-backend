const Joi = require('joi');

/**
 * Vehicle Validation Schemas using Joi
 * Validates vehicle creation and update requests
 */

/**
 * Schema for creating a vehicle
 * Enforces Colombian plate format: ABC123 (3 letters, 3 numbers)
 */
const createVehicleSchema = Joi.object({
  plate: Joi.string()
    .required()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{3}[0-9]{3}$/)
    .messages({
      'string.empty': 'Plate is required',
      'string.pattern.base': 'Plate must be in format ABC123 (3 letters, 3 numbers)',
      'any.required': 'Plate is required'
    }),

  brand: Joi.string()
    .required()
    .trim()
    .min(2)
    .max(60)
    .messages({
      'string.empty': 'Brand is required',
      'string.min': 'Brand must be at least 2 characters',
      'string.max': 'Brand must not exceed 60 characters',
      'any.required': 'Brand is required'
    }),

  model: Joi.string()
    .required()
    .trim()
    .min(1)
    .max(60)
    .messages({
      'string.empty': 'Model is required',
      'string.min': 'Model must be at least 1 character',
      'string.max': 'Model must not exceed 60 characters',
      'any.required': 'Model is required'
    }),

  capacity: Joi.number()
    .required()
    .integer()
    .min(1)
    .max(20)
    .messages({
      'number.base': 'Capacity must be a number',
      'number.min': 'Capacity must be at least 1',
      'number.max': 'Capacity must not exceed 20',
      'any.required': 'Capacity is required'
    }),

  // Temporary field for testing without authentication
  // TODO: Remove when authentication is implemented
  driverId: Joi.string()
    .optional()
    .messages({
      'string.base': 'Driver ID must be a string'
    })
}).options({
  stripUnknown: true,
  abortEarly: false
});

/**
 * Schema for updating a vehicle
 * All fields are optional, but at least one must be provided
 */
const updateVehicleSchema = Joi.object({
  brand: Joi.string()
    .trim()
    .min(2)
    .max(60)
    .messages({
      'string.min': 'Brand must be at least 2 characters',
      'string.max': 'Brand must not exceed 60 characters'
    }),

  model: Joi.string()
    .trim()
    .min(1)
    .max(60)
    .messages({
      'string.min': 'Model must be at least 1 character',
      'string.max': 'Model must not exceed 60 characters'
    }),

  capacity: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .messages({
      'number.base': 'Capacity must be a number',
      'number.min': 'Capacity must be at least 1',
      'number.max': 'Capacity must not exceed 20'
    }),

  // Temporary field for testing without authentication
  // TODO: Remove when authentication is implemented
  driverId: Joi.string()
    .optional()
    .messages({
      'string.base': 'Driver ID must be a string'
    })
}).min(1).options({
  stripUnknown: true,
  abortEarly: false
}).messages({
  'object.min': 'At least one field must be provided for update'
});

/**
 * Schema for vehicle photo uploads
 * Validates file metadata
 */
const vehiclePhotoSchema = Joi.object({
  fieldname: Joi.string().valid('vehiclePhoto', 'soatPhoto').required(),
  originalname: Joi.string().required(),
  encoding: Joi.string().required(),
  mimetype: Joi.string()
    .valid('image/jpeg', 'image/jpg', 'image/png', 'image/webp')
    .required()
    .messages({
      'any.only': 'Only JPEG, PNG, and WebP images are allowed'
    }),
  size: Joi.number()
    .max(5 * 1024 * 1024) // 5MB max
    .required()
    .messages({
      'number.max': 'File size must not exceed 5MB'
    }),
  destination: Joi.string(),
  filename: Joi.string(),
  path: Joi.string()
}).unknown(true);

module.exports = {
  createVehicleSchema,
  updateVehicleSchema,
  vehiclePhotoSchema
};

