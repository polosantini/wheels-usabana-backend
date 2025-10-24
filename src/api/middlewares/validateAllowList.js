/**
 * Allow-List Validator Middleware for PATCH /users/me
 * 
 * Single source of truth para campos permitidos/inmutables/desconocidos
 * 
 * ALLOW-LIST (campos permitidos para actualización):
 * - firstName
 * - lastName
 * - phone
 * - profilePhoto (manejado por upload adapter, no en body)
 * 
 * IMMUTABLE (campos prohibidos, generan 403):
 * - corporateEmail
 * - universityId
 * - role
 * - id
 * - password
 * 
 * UNKNOWN (campos desconocidos, generan 400):
 * - Cualquier otro campo no listado arriba
 */

// SINGLE SOURCE OF TRUTH - Allow-list de campos
const ALLOWED_FIELDS = ['firstName', 'lastName', 'phone'];

// SINGLE SOURCE OF TRUTH - Immutable fields
const IMMUTABLE_FIELDS = ['corporateEmail', 'universityId', 'role', 'id', 'password'];

/**
 * Middleware para validar allow-list en PATCH /users/me
 * 
 * Valida que:
 * 1. No se intenten modificar campos inmutables → 403 immutable_field
 * 2. No se envíen campos desconocidos → 400 invalid_schema
 * 3. Solo se permitan campos de la allow-list
 * 
 * NOTA: profilePhoto es manejado por el upload adapter (multer),
 * por lo que NO aparece en req.body sino en req.file
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const validateAllowList = (req, res, next) => {
  try {
    // Obtener todas las keys del body (sin considerar req.file)
    const bodyKeys = Object.keys(req.body);

    // Si no hay keys en body, puede ser que solo se esté subiendo una foto (req.file)
    // Esto es válido, dejar pasar al controller que verificará req.file
    if (bodyKeys.length === 0) {
      return next();
    }

    // 1. Check for IMMUTABLE fields (403)
    const immutableAttempts = bodyKeys.filter(key => IMMUTABLE_FIELDS.includes(key));
    
    if (immutableAttempts.length > 0) {
      // Cleanup de archivo subido si existe
      if (req.file && req.file.path) {
        const fs = require('fs').promises;
        fs.unlink(req.file.path).catch(err => 
          console.error('Error cleaning up file after immutable field error:', err)
        );
      }

      return res.status(403).json({
        code: 'immutable_field',
        message: 'One or more fields cannot be updated',
        details: immutableAttempts.map(field => ({
          field,
          issue: 'immutable'
        })),
        correlationId: req.correlationId
      });
    }

    // 2. Check for UNKNOWN fields (400)
    const unknownFields = bodyKeys.filter(key => !ALLOWED_FIELDS.includes(key));
    
    if (unknownFields.length > 0) {
      // Cleanup de archivo subido si existe
      if (req.file && req.file.path) {
        const fs = require('fs').promises;
        fs.unlink(req.file.path).catch(err => 
          console.error('Error cleaning up file after unknown field error:', err)
        );
      }

      return res.status(400).json({
        code: 'invalid_schema',
        message: 'Unknown fields provided',
        details: unknownFields.map(field => ({
          field,
          issue: 'unknown field'
        })),
        correlationId: req.correlationId
      });
    }

    // 3. All keys are in allow-list, proceed
    next();

  } catch (error) {
    // Cleanup de archivo en caso de error inesperado
    if (req.file && req.file.path) {
      const fs = require('fs').promises;
      fs.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
};

module.exports = {
  validateAllowList,
  ALLOWED_FIELDS,
  IMMUTABLE_FIELDS
};

