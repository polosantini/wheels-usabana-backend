const MongoUserRepository = require('../../infrastructure/repositories/MongoUserRepository');
const MongoVehicleRepository = require('../../infrastructure/repositories/MongoVehicleRepository');
const CreateUserDto = require('../dtos/CreateUserDto');
const UpdateProfileDto = require('../dtos/UpdateProfileDto');
const UserResponseDto = require('../dtos/UserResponseDto');
const DuplicateError = require('../errors/DuplicateError');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');

class UserService {
  constructor() {
    this.userRepository = new MongoUserRepository();
    this.vehicleRepository = new MongoVehicleRepository();
  }

  async registerUser(userData, file = null) {
    try {
      // Verificar duplicados antes de subir archivo
      const emailExists = await this.userRepository.exists('corporateEmail', userData.corporateEmail);
      if (emailExists) {
        throw new DuplicateError('Corporate email already exists', 'duplicate_email', {
          field: 'corporateEmail',
          value: userData.corporateEmail
        });
      }

      const universityIdExists = await this.userRepository.exists('universityId', userData.universityId);
      if (universityIdExists) {
        throw new DuplicateError('University ID already exists', 'duplicate_universityId', {
          field: 'universityId',
          value: userData.universityId
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(userData.password, 10);

      // Preparar datos del usuario
      const userDto = {
        firstName: userData.firstName,
        lastName: userData.lastName,
        universityId: userData.universityId,
        corporateEmail: userData.corporateEmail,
        phone: userData.phone,
        password: passwordHash,
        role: userData.role,
        profilePhoto: file ? `/uploads/profiles/${file.filename}` : null
      };

      // Crear usuario
      const user = await this.userRepository.create(userDto);
      return UserResponseDto.fromEntity(user);

    } catch (error) {
      // Cleanup file on error if it was uploaded
      if (file && file.path) {
        const fs = require('fs').promises;
        try {
          await fs.unlink(file.path);
        } catch (cleanupError) {
          console.error('Error cleaning up file:', cleanupError);
        }
      }
      throw error;
    }
  }

  async getUserById(id) {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error('User not found');
    }
    return UserResponseDto.fromEntity(user);
  }

  async getUserByEmail(email) {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      return null;
    }
    return UserResponseDto.fromEntity(user);
  }

  async updateUser(id, updates) {
    const user = await this.userRepository.update(id, updates);
    return UserResponseDto.fromEntity(user);
  }

  /**
   * Get current user's profile with driver.hasVehicle status
   * 
   * Contrato:
   * - Input: userId (string) - ID from JWT token (req.user.sub)
   * - Output: UserResponseDto with dynamic driver.hasVehicle
   * - Errors: 
   *   - user_not_found: User no longer exists (edge case)
   * 
   * Para passengers: NO incluye campo driver
   * Para drivers: Incluye driver: { hasVehicle: true|false }
   * 
   * @param {string} userId - User ID from JWT token
   * @returns {Promise<UserResponseDto>} - User profile DTO
   * @throws {Error} - If user not found
   */
  async getMyProfile(userId) {
    // Buscar usuario por ID
    const user = await this.userRepository.findById(userId);
    
    if (!user) {
      const error = new Error('User not found');
      error.code = 'user_not_found';
      throw error;
    }

    // Crear DTO base con datos del usuario
    const userDto = UserResponseDto.fromEntity(user);

    // Si es driver, verificar si tiene vehículo registrado
    if (user.role === 'driver') {
      const hasVehicle = await this.vehicleRepository.driverHasVehicle(userId);
      userDto.driver = { hasVehicle };
    }

    return userDto;
  }

  /**
   * Update current user's profile (partial update)
   * 
   * Contrato:
   * - Input: userId, UpdateProfileDto, optional file (from multer)
   * - Output: UserResponseDto con datos actualizados
   * - Side effects: 
   *   - Si se sube nueva foto, elimina la foto anterior
   *   - Si falla la actualización después de subir foto, limpia la nueva foto
   * 
   * ALLOW-LIST: firstName, lastName, phone, profilePhoto
   * IMMUTABLE: corporateEmail, universityId, role (validados en controller)
   * 
   * Photo replacement strategy:
   * 1. New photo is uploaded to disk by multer (before this method)
   * 2. We get old photo path from DB
   * 3. Update DB with new photo path
   * 4. Delete old photo from disk
   * 5. If update fails, cleanup new photo (handled by middleware)
   * 
   * @param {string} userId - User ID from JWT token
   * @param {UpdateProfileDto} updateProfileDto - DTO with allowed fields
   * @param {Object} file - Uploaded file from multer (optional)
   * @returns {Promise<UserResponseDto>} - Updated user profile
   * @throws {Error} - If user not found
   */
  async updateMyProfile(userId, updateProfileDto, file = null) {
    try {
      // Buscar usuario actual para obtener foto antigua
      const existingUser = await this.userRepository.findById(userId);
      
      if (!existingUser) {
        const error = new Error('User not found');
        error.code = 'user_not_found';
        throw error;
      }

      // Preparar datos de actualización
      const updateData = updateProfileDto.toObject();

      // Guardar referencia a la foto antigua para cleanup posterior
      const oldPhotoUrl = existingUser.profilePhoto;

      // Actualizar usuario en DB
      const updatedUser = await this.userRepository.update(userId, updateData);

      // Si se actualizó la foto exitosamente, eliminar la foto antigua
      if (updateData.profilePhoto && oldPhotoUrl) {
        const oldPhotoPath = path.join(__dirname, '../../../', oldPhotoUrl);
        try {
          await fs.unlink(oldPhotoPath);
          console.log(`✓ Deleted old profile photo: ${oldPhotoPath}`);
        } catch (err) {
          // No es crítico si falla el cleanup de la foto antigua
          console.error('Error deleting old profile photo:', err.message);
        }
      }

      // Crear DTO de respuesta con driver.hasVehicle si aplica
      const userDto = UserResponseDto.fromEntity(updatedUser);
      
      if (updatedUser.role === 'driver') {
        const hasVehicle = await this.vehicleRepository.driverHasVehicle(userId);
        userDto.driver = { hasVehicle };
      }

      return userDto;

    } catch (error) {
      // Si hay un archivo nuevo subido y ocurre error, limpiarlo
      // NOTA: El middleware cleanupOnError ya debería manejar esto,
      // pero agregamos un doble chequeo por seguridad
      if (file && file.path) {
        try {
          await fs.unlink(file.path);
          console.log(`✓ Cleaned up new photo after error: ${file.path}`);
        } catch (cleanupError) {
          console.error('Error cleaning up new photo:', cleanupError.message);
        }
      }
      throw error;
    }
  }

  /**
   * Update user role
   * 
   * @param {string} userId - User ID
   * @param {string} newRole - New role ('passenger' | 'driver')
   * @returns {Promise<Object>} - Updated user DTO
   */
  async updateUserRole(userId, newRole) {
    try {
      console.log(`[UserService] Updating user role | userId: ${userId} | newRole: ${newRole}`);
      
      // Validate role
      if (!['passenger', 'driver'].includes(newRole)) {
        throw new Error('Invalid role. Must be passenger or driver');
      }

      // Update user role
      const updatedUser = await this.userRepository.update(userId, { role: newRole });
      console.log(`[UserService] User role updated in DB | userId: ${userId}`);

      if (!updatedUser) {
        const error = new Error('User not found');
        error.code = 'user_not_found';
        throw error;
      }

      // Create response DTO with driver.hasVehicle if applicable
      const userDto = UserResponseDto.fromEntity(updatedUser);
      console.log(`[UserService] DTO created | role: ${userDto.role}`);
      
      if (updatedUser.role === 'driver') {
        console.log(`[UserService] Checking vehicle status for driver`);
        const hasVehicle = await this.vehicleRepository.driverHasVehicle(userId);
        userDto.driver = { hasVehicle };
        console.log(`[UserService] Vehicle status: ${hasVehicle}`);
      }

      console.log(`[UserService] Update user role completed successfully`);
      return userDto;

    } catch (error) {
      console.error('[UserService] Error in updateUserRole:', error);
      throw error;
    }
  }
}

module.exports = UserService;

