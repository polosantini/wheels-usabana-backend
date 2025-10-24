const Joi = require('joi');

// Schema para validación de registro de usuario
const createUserSchema = Joi.object({
  firstName: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .required()
    .messages({
      'string.min': 'First name must be at least 2 characters',
      'string.max': 'First name must not exceed 50 characters',
      'any.required': 'First name is required'
    }),
    
  lastName: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .required()
    .messages({
      'string.min': 'Last name must be at least 2 characters',
      'string.max': 'Last name must not exceed 50 characters',
      'any.required': 'Last name is required'
    }),
    
  corporateEmail: Joi.string()
    .email()
    .pattern(/@unisabana\.edu\.co$/)
    .required()
    .messages({
      'string.email': 'Must be a valid email address',
      'string.pattern.base': 'Must be a corporate domain (@unisabana.edu.co)',
      'any.required': 'Corporate email is required'
    }),
    
  universityId: Joi.string()
    .trim()
    .pattern(/^[0-9]{6,10}$/)
    .required()
    .messages({
      'string.pattern.base': 'University ID must be 6-10 digits',
      'any.required': 'University ID is required'
    }),
    
  phone: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      'string.pattern.base': 'Phone must be in E.164 format (+country code + number)',
      'any.required': 'Phone number is required'
    }),
    
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'any.required': 'Password is required'
    }),
    
  role: Joi.string()
    .valid('passenger', 'driver')
    .required()
    .messages({
      'any.only': 'Role must be either passenger or driver',
      'any.required': 'Role is required'
    })
});

/**
 * Schema para validación de actualización parcial de perfil
 * Solo permite campos de la allow-list: firstName, lastName, phone
 * Campos inmutables (corporateEmail, universityId, role) son rechazados en el controller
 * 
 * NOTA: NO usamos stripUnknown aquí porque necesitamos que los campos inmutables
 * lleguen al controller para generar el error 403 correspondiente.
 * 
 * NOTA 2: profilePhoto es manejado por multer (req.file), no por Joi (req.body).
 * Por lo tanto, si solo se sube foto sin campos de texto, req.body estará vacío
 * y eso es válido (el controller verificará req.file).
 */
const updateProfileSchema = Joi.object({
  firstName: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .optional()
    .messages({
      'string.min': 'First name must be at least 2 characters',
      'string.max': 'First name must not exceed 50 characters'
    }),
    
  lastName: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .optional()
    .messages({
      'string.min': 'Last name must be at least 2 characters',
      'string.max': 'Last name must not exceed 50 characters'
    }),
    
  phone: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Phone must be in E.164 format (+country code + number)'
    })
})
  // NO enforceamos .min(1) aquí porque profilePhoto puede ser el único cambio
  // y eso viene en req.file, no en req.body
  .unknown(true) // Permitir campos desconocidos (serán validados en controller)
  .options({
    abortEarly: false   // Reportar todos los errores
  });

module.exports = {
  createUserSchema,
  updateProfileSchema
};

