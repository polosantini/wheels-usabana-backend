const express = require('express');
const UserController = require('../controllers/userController');
const validateRequest = require('../middlewares/validateRequest');
const conditionalValidateRequest = require('../middlewares/conditionalValidation');
const { createUserSchema, updateProfileSchema } = require('../validation/userSchemas');
const { upload, handleUploadError, cleanupOnError } = require('../middlewares/uploadMiddleware');
const { publicRateLimiter, generalRateLimiter } = require('../middlewares/rateLimiter');
const authenticate = require('../middlewares/authenticate');
const { validateAllowList } = require('../middlewares/validateAllowList');
const requireCsrf = require('../middlewares/requireCsrf');

const router = express.Router();
const userController = new UserController();

/**
 * POST /users - Registrar nuevo usuario
 * 
 * Body (JSON):
 * - firstName: string (required)
 * - lastName: string (required)
 * - universityId: string (required)
 * - corporateEmail: string (required)
 * - phone: string (required)
 * - password: string (required)
 * - role: 'passenger' | 'driver' (required)
 * 
 * Body (multipart/form-data):
 * - Todos los campos anteriores como text fields
 * - profilePhoto: file (optional) - imagen JPEG/PNG/WebP, max 5MB
 * 
 * Response 201:
 * - Usuario creado con DTO sanitizado
 * - Para Driver: incluye driver: { hasVehicle: false }
 * 
 * Errors:
 * - 400: invalid_schema (validation errors)
 * - 409: duplicate_email | duplicate_universityId
 * - 413: payload_too_large (file size)
 * - 429: rate_limit_exceeded
 */
router.post(
  '/',
  publicRateLimiter, // Rate limiting para registro
  upload.single('profilePhoto'), // Manejar archivo opcional
  handleUploadError, // Manejar errores de upload
  cleanupOnError, // Cleanup automático en caso de error
  validateRequest(createUserSchema, 'body'), // Validar datos
  userController.register.bind(userController)
);

/**
 * @openapi
 * /api/users/me:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get my profile
 *     description: |
 *       Returns the authenticated user's profile with sanitized data.
 *       For drivers, includes `driver.hasVehicle` computed dynamically.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserResponseDto'
 *             examples:
 *               passenger:
 *                 summary: Passenger profile
 *                 value:
 *                   id: "665e2a...f1"
 *                   role: "passenger"
 *                   firstName: "Ana"
 *                   lastName: "Ruiz"
 *                   universityId: "202420023"
 *                   corporateEmail: "aruiz@unisabana.edu.co"
 *                   phone: "+573001112233"
 *                   profilePhotoUrl: "https://cdn.example/u/665e2a/avatar.jpg"
 *               driver:
 *                 summary: Driver profile with vehicle status
 *                 value:
 *                   id: "665e2a...f2"
 *                   role: "driver"
 *                   firstName: "Carlos"
 *                   lastName: "Gómez"
 *                   universityId: "202420024"
 *                   corporateEmail: "cgomez@unisabana.edu.co"
 *                   phone: "+573004445566"
 *                   profilePhotoUrl: null
 *                   driver:
 *                     hasVehicle: true
 *       401:
 *         description: Unauthorized - Missing or invalid session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *             examples:
 *               missingToken:
 *                 summary: No access_token cookie
 *                 value:
 *                   code: "unauthorized"
 *                   message: "Missing or invalid session"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               expiredToken:
 *                 summary: Token expired
 *                 value:
 *                   code: "token_expired"
 *                   message: "Session expired"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.get(
  '/me',
  generalRateLimiter,
  authenticate,
  userController.getMyProfile.bind(userController)
);

/**
 * POST /api/users/me/toggle-role
 * Toggle user role between passenger and driver
 */
router.post(
  '/me/toggle-role',
  generalRateLimiter,
  authenticate,
  requireCsrf,
  userController.toggleRole.bind(userController)
);

/**
 * @openapi
 * /api/users/me:
 *   patch:
 *     tags:
 *       - Users
 *     summary: Update my profile (partial)
 *     description: |
 *       Update authenticated user's profile. Supports JSON and multipart/form-data.
 *       
 *       **Allowed fields**: `firstName`, `lastName`, `phone`, `profilePhoto` (file)
 *       **Immutable fields** (403): `corporateEmail`, `universityId`, `role`, `id`, `password`
 *       
 *       Photo replacement is atomic: old photo deleted only after successful update.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProfileRequest'
 *           examples:
 *             updateName:
 *               summary: Update first name only
 *               value:
 *                 firstName: "Ana María"
 *             updatePhone:
 *               summary: Update phone only
 *               value:
 *                 phone: "+573001112244"
 *             updateMultiple:
 *               summary: Update multiple fields
 *               value:
 *                 firstName: "Ana María"
 *                 lastName: "Ruiz García"
 *                 phone: "+573001112244"
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               phone:
 *                 type: string
 *                 pattern: '^\\+[1-9]\\d{1,14}$'
 *               profilePhoto:
 *                 type: string
 *                 format: binary
 *                 description: JPEG, PNG, or WebP image (max 5MB)
 *           examples:
 *             withPhoto:
 *               summary: Update with new profile photo
 *               value:
 *                 firstName: "Ana María"
 *                 profilePhoto: "(binary file data)"
 *             photoOnly:
 *               summary: Replace photo without other changes
 *               value:
 *                 profilePhoto: "(binary file data)"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserResponseDto'
 *             examples:
 *               updated:
 *                 summary: Updated profile
 *                 value:
 *                   id: "665e2a...f1"
 *                   role: "passenger"
 *                   firstName: "Ana María"
 *                   lastName: "Ruiz"
 *                   universityId: "202420023"
 *                   corporateEmail: "aruiz@unisabana.edu.co"
 *                   phone: "+573001112244"
 *                   profilePhotoUrl: "/uploads/profiles/profilePhoto-1701010101010-123.jpg"
 *       400:
 *         description: Validation error or unknown field
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             examples:
 *               validationFailed:
 *                 summary: Invalid field format
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "firstName"
 *                       issue: "firstName length must be at least 2 characters long"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               unknownField:
 *                 summary: Unknown field provided
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Unknown fields provided"
 *                   details:
 *                     - field: "unknownField"
 *                       issue: "unknown field"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               invalidFileType:
 *                 summary: Invalid MIME type
 *                 value:
 *                   code: "invalid_file_type"
 *                   message: "Unsupported MIME type"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Unauthorized - Missing or invalid session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden - Attempt to modify immutable field
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorForbidden'
 *             examples:
 *               immutableField:
 *                 summary: Attempt to change corporateEmail
 *                 value:
 *                   code: "immutable_field"
 *                   message: "One or more fields cannot be updated"
 *                   details:
 *                     - field: "corporateEmail"
 *                       issue: "immutable"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               multipleImmutable:
 *                 summary: Multiple immutable fields
 *                 value:
 *                   code: "immutable_field"
 *                   message: "One or more fields cannot be updated"
 *                   details:
 *                     - field: "corporateEmail"
 *                       issue: "immutable"
 *                     - field: "role"
 *                       issue: "immutable"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       413:
 *         description: Payload too large - File exceeds size limit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorPayloadTooLarge'
 *             example:
 *               code: "payload_too_large"
 *               message: "File exceeds limit"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.patch(
  '/me',
  generalRateLimiter,
  authenticate,
  requireCsrf,        // CSRF protection for state-changing route
  upload.single('profilePhoto'),
  handleUploadError,
  cleanupOnError,
  validateAllowList,  // Dedicated allow-list validator (403 immutable, 400 unknown)
  conditionalValidateRequest(updateProfileSchema, 'body'),  // Validate only if body has fields
  userController.updateMyProfile.bind(userController)
);

module.exports = router;

