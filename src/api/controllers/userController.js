const UserService = require('../../domain/services/UserService');
const AuthService = require('../../domain/services/AuthService');
const MongoUserRepository = require('../../infrastructure/repositories/MongoUserRepository');
const UpdateProfileDto = require('../../domain/dtos/UpdateProfileDto');
const { generateCsrfToken, setCsrfCookie } = require('../../utils/csrf');

class UserController {
  constructor() {
    this.userService = new UserService();
    this.authService = new AuthService();
    this.userRepository = new MongoUserRepository();
  }

  /**
   * POST /users - Registrar nuevo usuario
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next middleware
   */
  async register(req, res, next) {
    try {
      const { firstName, lastName, universityId, corporateEmail, phone, password, role } = req.body;
      const profilePhoto = req.file; // Archivo subido por Multer

      // Crear objeto con datos del usuario
      const userData = {
        firstName,
        lastName,
        universityId,
        corporateEmail,
        phone,
        password,
        role
      };

      // Registrar usuario usando el servicio
      const user = await this.userService.registerUser(userData, profilePhoto);

      // Generate JWT token for auto-login after registration
      const token = this.authService.signAccessToken({
        sub: user.id,
        role: user.role,
        email: user.corporateEmail
      });

      // Set httpOnly cookie with JWT (auto-login)
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieMaxAge = 2 * 60 * 60 * 1000; // 2 hours

      res.cookie('access_token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        maxAge: cookieMaxAge,
        path: '/'
      });

      // Generate and set CSRF token
      const csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);

      // Respuesta exitosa
      res.status(201).json(user);

    } catch (error) {
      // Si hay archivo subido y ocurre error, limpiarlo
      if (req.file && req.file.path) {
        const fs = require('fs').promises;
        fs.unlink(req.file.path).catch(err => console.error('Error cleaning temp file:', err));
      }
      
      next(error);
    }
  }

  /**
   * GET /users/me - Obtener perfil del usuario autenticado
   * 
   * Contrato:
   * - Auth: JWT en cookie 'access_token' (verificado por middleware authenticate)
   * - Input: req.user.sub (userId desde JWT)
   * - Output: UserResponseDto con driver.hasVehicle si aplica
   * 
   * Response 200:
   * {
   *   "id": "665e2a...f1",
   *   "role": "passenger|driver",
   *   "firstName": "Ana",
   *   "lastName": "Ruiz",
   *   "universityId": "202420023",
   *   "corporateEmail": "aruiz@uni.edu",
   *   "phone": "+573001112233",
   *   "profilePhotoUrl": "/uploads/profiles/ana.jpg",
   *   "driver": { "hasVehicle": false }  // Solo para drivers
   * }
   * 
   * Errors:
   * - 401 unauthorized: Sin token o token inválido (manejado por middleware)
   * - 404 user_not_found: Usuario no existe (edge case)
   * 
   * @param {Object} req - Request object with req.user from authenticate middleware
   * @param {Object} res - Response object
   * @param {Function} next - Next middleware
   */
  async getMyProfile(req, res, next) {
    try {
      // req.user viene del middleware authenticate
      // req.user = { sub: userId, role, email, iat, exp }
      const userId = req.user.sub;
      
      // Obtener perfil con driver.hasVehicle si aplica
      const profile = await this.userService.getMyProfile(userId);
      
      // Respuesta exitosa
      res.status(200).json(profile);
      
    } catch (error) {
      // Si el usuario no existe (edge case: usuario eliminado pero token válido)
      if (error.code === 'user_not_found') {
        return res.status(404).json({
          code: 'user_not_found',
          message: 'User not found',
          correlationId: req.correlationId
        });
      }
      
      // Otros errores pasan al error handler global
      next(error);
    }
  }

  /**
   * POST /users/me/toggle-role - Alternar rol entre passenger y driver
   * 
   * @param {Object} req - Request with authenticated user
   * @param {Object} res - Response object
   * @param {Function} next - Next middleware
   */
  async toggleRole(req, res, next) {
    try {
      const userId = req.user.sub;
      
      // Get current user entity (not DTO)
      const user = await this.userRepository.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          code: 'user_not_found',
          message: 'User not found',
          correlationId: req.correlationId
        });
      }
      
      // Toggle role
      const oldRole = user.role;
      const newRole = user.role === 'passenger' ? 'driver' : 'passenger';
      
      console.log(`[UserController] Toggling role | userId: ${userId} | oldRole: ${oldRole} | newRole: ${newRole}`);
      
      // Update user role
      const updatedUser = await this.userService.updateUserRole(userId, newRole);
      
      console.log(`[UserController] Role toggled successfully | userId: ${userId}`);
      
      // Generate NEW JWT token with the NEW role
      const token = this.authService.signAccessToken({
        sub: updatedUser.id,
        role: updatedUser.role,
        email: updatedUser.corporateEmail
      });

      // Set NEW httpOnly cookie with updated JWT
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieMaxAge = 2 * 60 * 60 * 1000; // 2 hours

      res.cookie('access_token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        maxAge: cookieMaxAge,
        path: '/'
      });

      console.log(`[UserController] New JWT token generated with role: ${updatedUser.role}`);
      
      res.status(200).json(updatedUser);
      
    } catch (error) {
      console.error('[UserController] Toggle role error:', error);
      next(error);
    }
  }

  /**
   * PATCH /users/me - Actualizar perfil del usuario autenticado (parcial)
   * 
   * Contrato:
   * - Auth: JWT en cookie 'access_token' (verificado por middleware authenticate)
   * - Input: req.user.sub (userId), req.body (allowed fields), req.file (optional photo)
   * - ALLOW-LIST: firstName, lastName, phone, profilePhoto
   * - IMMUTABLE (403): corporateEmail, universityId, role, id, password
   * 
   * Request (JSON):
   * Content-Type: application/json
   * { "firstName": "Ana María", "phone": "+573001112244" }
   * 
   * Request (multipart/form-data):
   * Content-Type: multipart/form-data
   * - firstName: text
   * - profilePhoto: file (image/jpeg|png|webp, max 5MB)
   * 
   * Response 200:
   * {
   *   "id": "665e2a...f1",
   *   "role": "passenger",
   *   "firstName": "Ana María",  // Updated
   *   "lastName": "Ruiz",
   *   "universityId": "202420023",
   *   "corporateEmail": "aruiz@uni.edu",
   *   "phone": "+573001112244",  // Updated
   *   "profilePhotoUrl": "/uploads/profiles/new.jpg",  // Updated
   *   "driver": { "hasVehicle": false }
   * }
   * 
   * Errors:
   * - 400 invalid_schema: Validation failed
   * - 401 unauthorized: Sin token o token inválido (middleware)
   * - 403 immutable_field: Intento de cambiar campo inmutable
   * - 404 user_not_found: Usuario no existe (edge case)
   * - 413 payload_too_large: File size exceeds limit (middleware)
   * 
   * @param {Object} req - Request with req.user, req.body, req.file
   * @param {Object} res - Response object
   * @param {Function} next - Next middleware
   */
  async updateMyProfile(req, res, next) {
    try {
      // req.user viene del middleware authenticate
      const userId = req.user.sub;

      // NOTA: La validación de campos inmutables y desconocidos se hace en
      // el middleware validateAllowList ANTES de llegar aquí.
      // Este controller solo maneja la lógica de negocio.

      // Crear DTO desde request (JSON o multipart)
      let updateProfileDto;
      if (req.file) {
        // Multipart/form-data con foto
        updateProfileDto = UpdateProfileDto.fromMultipart(req.body, req.file);
      } else {
        // JSON sin foto
        updateProfileDto = UpdateProfileDto.fromRequest(req.body);
      }

      // Verificar que haya al menos un campo para actualizar
      // NOTA: Si solo se sube foto (req.file), el DTO puede estar "vacío" en términos
      // de campos de texto, pero sí tiene profilePhotoUrl. Por eso verificamos ambos.
      if (updateProfileDto.isEmpty() && !req.file) {
        return res.status(400).json({
          code: 'invalid_schema',
          message: 'At least one field must be provided for update',
          correlationId: req.correlationId
        });
      }

      // Actualizar perfil
      const updatedProfile = await this.userService.updateMyProfile(
        userId,
        updateProfileDto,
        req.file
      );

      // Respuesta exitosa
      res.status(200).json(updatedProfile);

    } catch (error) {
      // Si el usuario no existe
      if (error.code === 'user_not_found') {
        return res.status(404).json({
          code: 'user_not_found',
          message: 'User not found',
          correlationId: req.correlationId
        });
      }

      // Cleanup de archivo en caso de error (doble chequeo)
      if (req.file && req.file.path) {
        const fs = require('fs').promises;
        await fs.unlink(req.file.path).catch(() => {});
      }

      // Otros errores pasan al error handler global
      next(error);
    }
  }
}

module.exports = UserController;

