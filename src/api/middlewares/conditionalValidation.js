/**
 * Conditional Validation Middleware
 * 
 * Ejecuta validación Joi solo si hay campos en req.body
 * Si solo se sube archivo (req.file) sin campos, skip la validación
 */

const validateRequest = require('./validateRequest');

/**
 * Wrapper para validateRequest que solo ejecuta si hay campos en body
 * 
 * @param {Object} schema - Joi schema
 * @param {string} target - 'body', 'query', o 'params'
 * @returns {Function} Middleware function
 */
const conditionalValidateRequest = (schema, target = 'body') => {
  return (req, res, next) => {
    // Si el target es 'body' y está vacío, pero hay archivo, skip validación
    if (target === 'body' && Object.keys(req.body).length === 0 && req.file) {
      return next();
    }

    // De lo contrario, ejecutar validación normal
    return validateRequest(schema, target)(req, res, next);
  };
};

module.exports = conditionalValidateRequest;

