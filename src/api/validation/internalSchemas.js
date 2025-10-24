/**
 * Internal API Validation Schemas
 * 
 * Joi schemas for admin-only internal endpoints:
 * - Job execution
 * - System maintenance
 * - Health checks
 */

const Joi = require('joi');

/**
 * Schema for job execution query params
 * POST /internal/jobs/run?name=complete-trips&pendingTtlHours=48
 */
const runJobQuerySchema = Joi.object({
  name: Joi.string()
    .valid('complete-trips', 'auto-complete-trips', 'expire-pendings')
    .default('complete-trips')
    .messages({
      'any.only': 'Job name must be one of: complete-trips, auto-complete-trips, expire-pendings'
    }),
  pendingTtlHours: Joi.number()
    .integer()
    .min(1)
    .max(168) // Max 7 days
    .default(48)
    .messages({
      'number.base': 'pendingTtlHours must be a number',
      'number.integer': 'pendingTtlHours must be an integer',
      'number.min': 'pendingTtlHours must be at least 1 hour',
      'number.max': 'pendingTtlHours cannot exceed 168 hours (7 days)'
    })
}).options({
  abortEarly: false
});

module.exports = {
  runJobQuerySchema
};
