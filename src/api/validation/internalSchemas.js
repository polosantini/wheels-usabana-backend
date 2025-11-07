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
    .valid('complete-trips', 'auto-complete-trips', 'expire-pendings', 'verification-expiry-scan', 'audit-anchor')
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

/**
 * Schema for POST /internal/notifications/templates/render
 * Body: { channel: 'email'|'in-app', type: 'payment.succeeded', variables: { ... } }
 */
const renderTemplateBodySchema = Joi.object({
  channel: Joi.string().valid('email', 'in-app').required(),
  type: Joi.string().valid('payment.succeeded').required(),
  locale: Joi.string().valid('en','es').default('en'),
  variables: Joi.object().default({})
}).options({ abortEarly: false });

/**
 * Schema for POST /internal/notifications/dispatch
 */
const dispatchNotificationBodySchema = Joi.object({
  channel: Joi.string().valid('email', 'in-app', 'both').default('both'),
  type: Joi.string().required(),
  userId: Joi.string().required(),
  variables: Joi.object().default({})
}).options({ abortEarly: false });

/**
 * Schema for POST /internal/notifications/templates/validate
 * Accepts a draft template payload for validation/linting
 */
const validateTemplateBodySchema = Joi.object({
  type: Joi.string().required(),
  locale: Joi.string().valid('en','es').default('en'),
  subject: Joi.string().required(),
  html: Joi.string().allow('').required(),
  text: Joi.string().allow('').required(),
  schema: Joi.object().optional(),
  partials: Joi.object().pattern(Joi.string(), Joi.string()).optional()
}).options({ abortEarly: false });

/**
 * Schema for PATCH /admin/drivers/:driverId/verification
 * Body: { action: 'approve' | 'reject', reason?: string, comment?: string }
 */
const reviewDriverVerificationBodySchema = Joi.object({
  action: Joi.string().valid('approve','reject').required(),
  reason: Joi.when('action', {
    is: 'reject',
    then: Joi.string().min(3).required(),
    otherwise: Joi.forbidden()
  }),
  comment: Joi.string().allow('').optional()
}).options({ abortEarly: false });

module.exports = {
  runJobQuerySchema
  , renderTemplateBodySchema
  , dispatchNotificationBodySchema
  , validateTemplateBodySchema
  , reviewDriverVerificationBodySchema
};
