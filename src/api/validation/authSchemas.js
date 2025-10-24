/**
 * Auth Validation Schemas (Joi)
 * 
 * Validates authentication-related requests
 */

const Joi = require('joi');

/**
 * Login Schema
 * 
 * Fields:
 * - corporateEmail: Valid email format (required)
 * - password: String, min 8 chars (required)
 * 
 * Note: We validate format here, but don't reveal if email exists
 * in the error response (prevents user enumeration)
 */
const loginSchema = Joi.object({
  corporateEmail: Joi.string()
    .email()
    .required()
    .trim()
    .lowercase()
    .messages({
      'string.email': 'corporateEmail must be a valid email address',
      'any.required': 'corporateEmail is required',
      'string.empty': 'corporateEmail cannot be empty'
    }),
  
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'password must be at least 8 characters long',
      'any.required': 'password is required',
      'string.empty': 'password cannot be empty'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

/**
 * Password Reset Request Schema
 * 
 * Fields:
 * - corporateEmail: Valid email format (required)
 * 
 * Security: Always returns generic success, never reveals if email exists
 */
const passwordResetRequestSchema = Joi.object({
  corporateEmail: Joi.string()
    .email()
    .required()
    .trim()
    .lowercase()
    .messages({
      'string.email': 'corporateEmail must be a valid email address',
      'any.required': 'corporateEmail is required',
      'string.empty': 'corporateEmail cannot be empty'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

/**
 * Password Reset Schema (Token Redemption)
 * 
 * Fields:
 * - token: Base64url string from email link (required)
 * - newPassword: Strong password, min 8 chars (required)
 * 
 * Password Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * 
 * Error Codes:
 * - 400 invalid_schema: Validation failed
 * - 400 invalid_token: Token not found or invalid format
 * - 410 token_expired: Token has expired
 * - 409 token_used: Token already consumed
 */
const passwordResetSchema = Joi.object({
  token: Joi.string()
    .required()
    .trim()
    .pattern(/^[A-Za-z0-9_-]+$/)  // Base64url characters only
    .min(43)  // 32 bytes base64url encoded = 43+ chars
    .messages({
      'string.pattern.base': 'token must be a valid reset token',
      'string.min': 'token appears to be invalid',
      'any.required': 'token is required',
      'string.empty': 'token cannot be empty'
    }),
  
  newPassword: Joi.string()
    .min(8)
    .max(128)
    .required()
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .messages({
      'string.min': 'newPassword must be at least 8 characters long',
      'string.max': 'newPassword must not exceed 128 characters',
      'string.pattern.base': 'newPassword must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
      'any.required': 'newPassword is required',
      'string.empty': 'newPassword cannot be empty'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

/**
 * Password Change Schema (In-session)
 * 
 * Fields:
 * - currentPassword: Current password for verification (required)
 * - newPassword: Strong new password, min 8 chars (required)
 * 
 * Password Requirements (newPassword):
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * 
 * Error Codes:
 * - 401 invalid_credentials: Current password is incorrect
 * - 400 invalid_schema: Validation failed (weak password)
 * 
 * Note: Requires authentication (JWT cookie)
 */
const passwordChangeSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .min(1)  // Just verify it's not empty, actual verification happens in service
    .messages({
      'any.required': 'currentPassword is required',
      'string.empty': 'currentPassword cannot be empty',
      'string.min': 'currentPassword cannot be empty'
    }),
  
  newPassword: Joi.string()
    .min(8)
    .max(128)
    .required()
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .messages({
      'string.min': 'newPassword must be at least 8 characters long',
      'string.max': 'newPassword must not exceed 128 characters',
      'string.pattern.base': 'newPassword must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
      'any.required': 'newPassword is required',
      'string.empty': 'newPassword cannot be empty'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

module.exports = {
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  passwordChangeSchema
};

