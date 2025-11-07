const Joi = require('joi');

const createReviewBodySchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  text: Joi.string().max(1000).allow('').optional(),
  tags: Joi.array().items(Joi.string().max(50)).max(5).optional()
});

const listReviewsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(50).default(10)
});

const updateReviewBodySchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).optional(),
  text: Joi.string().max(1000).optional().allow(''),
  tags: Joi.array().items(Joi.string().max(50)).max(5).optional()
}).options({ abortEarly: false });

// Schema for reviewId parameter (MongoDB ObjectId)
const reviewIdParamSchema = Joi.object({
  reviewId: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({
      'string.pattern.base': 'reviewId must be a valid MongoDB ObjectId',
      'any.required': 'reviewId is required'
    })
}).options({ abortEarly: false });

const reviewParamsSchema = Joi.object({
  tripId: Joi.string().pattern(/^[a-f\d]{24}$/i).required().messages({ 'string.pattern.base': 'tripId must be a valid MongoDB ObjectId' }),
  reviewId: Joi.string().pattern(/^[a-f\d]{24}$/i).required().messages({ 'string.pattern.base': 'reviewId must be a valid MongoDB ObjectId' })
}).options({ abortEarly: false });

const reportReviewBodySchema = Joi.object({
  category: Joi.string().valid('abuse', 'spam', 'fraud', 'other').required(),
  reason: Joi.string().trim().max(500).optional().allow('').messages({
    'string.max': 'Reason cannot exceed 500 characters'
  })
}).options({ abortEarly: false });

// Admin visibility action schema
const adminVisibilityBodySchema = Joi.object({
  action: Joi.string().valid('hide', 'unhide').required(),
  reason: Joi.string().trim().max(500).required().messages({
    'any.required': 'Reason is required for moderation actions',
    'string.max': 'Reason cannot exceed 500 characters'
  })
}).options({ abortEarly: false });

module.exports = { createReviewBodySchema, listReviewsQuerySchema, reviewIdParamSchema, reportReviewBodySchema, adminVisibilityBodySchema, updateReviewBodySchema, reviewParamsSchema };
