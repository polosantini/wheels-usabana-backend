const Joi = require('joi');

/**
 * Middleware para validar request body con Joi
 * @param {Joi.ObjectSchema} schema - Schema de Joi para validación
 * @param {string} property - Propiedad del request a validar ('body', 'query', 'params')
 */
const validateRequest = (schema, property = 'body') => {
  return (req, res, next) => {
    // Use schema options if defined, otherwise use defaults
    const { error, value } = schema.validate(req[property]);

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        issue: detail.message
      }));

      return res.status(400).json({
        code: 'invalid_schema',
        message: 'Validation failed',
        details,
        correlationId: req.correlationId
      });
    }

    // Reemplazar el request con los datos validados y sanitizados
    req[property] = value;
    next();
  };
};

module.exports = validateRequest;

