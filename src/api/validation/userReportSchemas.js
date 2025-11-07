const Joi = require('joi');

const reportUserSchema = Joi.object({
  tripId: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({
      'string.pattern.base': 'tripId must be a valid MongoDB ObjectId',
      'any.required': 'tripId is required'
    }),
  category: Joi.string()
    .valid('abuse', 'harassment', 'fraud', 'no_show', 'unsafe_behavior', 'other')
    .required()
    .messages({
      'any.only': 'Categoría de reporte inválida',
      'any.required': 'La categoría es requerida'
    }),
  reason: Joi.string()
    .trim()
    .max(500)
    .optional()
    .allow('')
    .default('')
    .messages({
      'string.max': 'La razón no puede exceder 500 caracteres'
    })
}).options({ abortEarly: false });

module.exports = {
  reportUserSchema
};
