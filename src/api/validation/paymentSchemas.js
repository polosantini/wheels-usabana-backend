/**
 * Payment Validation Schemas (US-4.1.2)
 * 
 * Joi validation schemas for payment-related requests.
 */

const Joi = require('joi');

/**
 * Create Payment Intent Request Schema
 * 
 * Fields:
 * - bookingId: MongoDB ObjectId (required)
 * 
 * Used for: POST /passengers/payments/intents
 */
const createPaymentIntentSchema = Joi.object({
  bookingId: Joi.string()
    .required()
    .pattern(/^[a-f\d]{24}$/i)
    .messages({
      'string.pattern.base': 'bookingId must be a valid MongoDB ObjectId',
      'any.required': 'bookingId is required',
      'string.empty': 'bookingId cannot be empty'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

/**
 * Get Transactions Query Schema (US-4.1.4)
 * 
 * Query Parameters:
 * - status: Array of transaction statuses (optional, multi-select filter)
 * - page: Positive integer (optional, default: 1)
 * - pageSize: Integer 1-100 (optional, default: 10)
 * 
 * Used for: GET /passengers/transactions
 */
const getTransactionsQuerySchema = Joi.object({
  status: Joi.alternatives()
    .try(
      Joi.string().valid('requires_payment_method', 'processing', 'succeeded', 'failed', 'canceled', 'refunded'),
      Joi.array().items(
        Joi.string().valid('requires_payment_method', 'processing', 'succeeded', 'failed', 'canceled', 'refunded')
      )
    )
    .messages({
      'any.only': 'status must be one of: requires_payment_method, processing, succeeded, failed, canceled, refunded'
    }),
  
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      'number.base': 'page must be a number',
      'number.integer': 'page must be an integer',
      'number.min': 'page must be at least 1'
    }),
  
  pageSize: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10)
    .messages({
      'number.base': 'pageSize must be a number',
      'number.integer': 'pageSize must be an integer',
      'number.min': 'pageSize must be at least 1',
      'number.max': 'pageSize must not exceed 100'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

module.exports = {
  createPaymentIntentSchema,
  getTransactionsQuerySchema
};
