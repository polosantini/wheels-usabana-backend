const UserRepository = require('../../domain/repositories/UserRepository');
const UserModel = require('../database/models/UserModel');
const DuplicateError = require('../../domain/errors/DuplicateError');
const ValidationError = require('../../domain/errors/ValidationError');
const User = require('../../domain/entities/User');

class MongoUserRepository extends UserRepository {

  /**
   * Crea un nuevo usuario
   * @param {Object} userData - Datos del usuario
   * @returns {Promise<User>} Usuario creado
   * @throws {DuplicateError} Si email o universityId ya existen
   * @throws {ValidationError} Si los datos son inválidos
   */
  async create(userData) {
    try {
      const user = new UserModel(userData);
      const savedUser = await user.save();
      return User.fromDocument(savedUser);
      
    } catch (error) {
      // CRÍTICO: Traducir E11000 a DuplicateError
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        let code;
        
        if (field === 'corporateEmail') {
          code = 'duplicate_email';
        } else if (field === 'universityId') {
          code = 'duplicate_universityId';
        } else if (field === 'phone') {
          code = 'duplicate_phone';
        } else {
          code = `duplicate_${field}`;
        }
        
        throw new DuplicateError(
          `${field} already exists`,
          code,
          { field, value: error.keyValue[field] }
        );
      }
      
      // Errores de validación de Mongoose
      if (error.name === 'ValidationError') {
        throw new ValidationError(
          'Invalid user data',
          'invalid_schema',
          this._formatValidationErrors(error)
        );
      }
      
      throw error;
    }
  }
  
  /**
   * Busca usuario por ID
   * @param {string} id - ID del usuario
   * @returns {Promise<User|null>} Usuario encontrado o null
   */
  async findById(id) {
    try {
      const doc = await UserModel.findById(id);
      return doc ? User.fromDocument(doc) : null;
    } catch (error) {
      // Si el ID no es válido, retornar null
      if (error.name === 'CastError') {
        return null;
      }
      throw error;
    }
  }
  
  /**
   * Busca usuario por email corporativo
   * @param {string} email - Email corporativo
   * @returns {Promise<User|null>} Usuario encontrado o null
   */
  async findByEmail(email) {
    const doc = await UserModel.findOne({ 
      corporateEmail: email.toLowerCase() 
    });
    return doc ? User.fromDocument(doc) : null;
  }
  
  /**
   * Busca usuario por ID universitario
   * @param {string} universityId - ID universitario
   * @returns {Promise<User|null>} Usuario encontrado o null
   */
  async findByUniversityId(universityId) {
    const doc = await UserModel.findOne({ universityId });
    return doc ? User.fromDocument(doc) : null;
  }
  
  /**
   * Verifica si existe un usuario con el campo y valor especificados
   * @param {string} field - Campo a verificar
   * @param {string} value - Valor a buscar
   * @returns {Promise<boolean>} True si existe, false si no
   */
  async exists(field, value) {
    const query = { [field]: field === 'corporateEmail' 
      ? value.toLowerCase() 
      : value 
    };
    const count = await UserModel.countDocuments(query);
    return count > 0;
  }

  //Método para actualizar un usuario existente:
  async update(id, updates) {
    try {
      const updatedUser = await UserModel.findByIdAndUpdate(id, updates, {new: true, runValidators: true});
      if (!updatedUser) { return null;}
      return User.fromDocument(updatedUser);
    } catch (error) {
      // Handle duplicate key error
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        let code;
        
        if (field === 'corporateEmail') {
          code = 'duplicate_email';
        } else if (field === 'universityId') {
          code = 'duplicate_universityId';
        } else if (field === 'phone') {
          code = 'duplicate_phone';
        } else {
          code = `duplicate_${field}`;
        }
        
        throw new DuplicateError(
          `${field} already exists`,
          code,
          { field, value: error.keyValue[field] }
        );
      }
      
      if (error.name === 'ValidationError') {
        throw new ValidationError('Invalid update data', 'invalid_schema',this._formatValidationErrors(error));
      }
      throw error;
    }
  }

  /**
   * Find user by email with reset token fields
   * 
   * Includes resetPasswordToken, resetPasswordExpires, resetPasswordConsumed
   * (normally excluded by select: false)
   * 
   * @param {string} email - Corporate email
   * @returns {Promise<User|null>} - User with reset fields or null
   */
  async findByEmailWithResetFields(email) {
    const doc = await UserModel.findOne({ 
      corporateEmail: email.toLowerCase() 
    }).select('+resetPasswordToken +resetPasswordExpires +resetPasswordConsumed');
    
    return doc ? User.fromDocument(doc) : null;
  }

  /**
   * Update user's reset token fields
   * 
   * @param {string} userId - User ID
   * @param {Object} tokenData - { resetPasswordToken, resetPasswordExpires, resetPasswordConsumed }
   * @returns {Promise<void>}
   */
  async updateResetToken(userId, tokenData) {
    await UserModel.findByIdAndUpdate(
      userId,
      {
        resetPasswordToken: tokenData.resetPasswordToken,
        resetPasswordExpires: tokenData.resetPasswordExpires,
        resetPasswordConsumed: tokenData.resetPasswordConsumed
      },
      { runValidators: false } // Skip validators for system fields
    );
  }

  /**
   * Find user by reset token hash
   * 
   * Includes password and all reset fields for token validation
   * 
   * @param {string} tokenHash - SHA-256 hash of the token
   * @returns {Promise<Object|null>} - User document with reset fields or null
   */
  async findByResetToken(tokenHash) {
    const doc = await UserModel.findOne({
      resetPasswordToken: tokenHash
    }).select('+password +resetPasswordToken +resetPasswordExpires +resetPasswordConsumed +passwordChangedAt');
    
    return doc ? User.fromDocument(doc) : null;
  }

  /**
   * Update password and consume reset token
   * 
   * Sets new password hash, marks token as consumed, and updates passwordChangedAt
   * 
   * @param {string} userId - User ID
   * @param {string} newPasswordHash - Bcrypt hash of new password
   * @returns {Promise<void>}
   */
  async updatePasswordAndConsumeToken(userId, newPasswordHash) {
    const now = new Date();
    
    await UserModel.findByIdAndUpdate(
      userId,
      {
        password: newPasswordHash,
        resetPasswordConsumed: now,
        passwordChangedAt: now
      },
      { runValidators: false } // Skip validators for system fields
    );
  }

  /**
   * Update user password (in-session password change)
   * 
   * Updates password hash and passwordChangedAt timestamp
   * 
   * @param {string} userId - User ID
   * @param {string} newPasswordHash - Bcrypt hash of new password
   * @returns {Promise<void>}
   */
  async updatePassword(userId, newPasswordHash) {
    const now = new Date();
    
    await UserModel.findByIdAndUpdate(
      userId,
      {
        password: newPasswordHash,
        passwordChangedAt: now
      },
      { runValidators: false } // Skip validators for system fields
    );
  }

  //Conversión de errores de Mongoose a formato details
  _formatValidationErrors(error) {
    return Object.keys(error.errors).map(field => ({ field, issue: error.errors[field].message }));
  }
}

module.exports = MongoUserRepository;

