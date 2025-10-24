const express = require('express');
const AuthController = require('../controllers/authController');
const UserController = require('../controllers/userController');
const validateRequest = require('../middlewares/validateRequest');
const { loginSchema, passwordResetRequestSchema, passwordResetSchema, passwordChangeSchema } = require('../validation/authSchemas');
const { createUserSchema } = require('../validation/userSchemas');
const { loginRateLimiter, passwordResetRateLimiter, publicRateLimiter } = require('../middlewares/rateLimiter');
const authenticate = require('../middlewares/authenticate');
const { upload, handleUploadError, cleanupOnError } = require('../middlewares/uploadMiddleware');

const router = express.Router();
const authController = new AuthController();
const userController = new UserController();

/**
 * AUTH ROUTES
 * 
 * Endpoints:
 * - POST /auth/register - Register new user
 * - POST /auth/login - Create session (set JWT cookie)
 * - POST /auth/logout - Destroy session (clear cookie)
 * - GET /auth/me - Get current user session/identity (protected)
 * 
 * Security:
 * - Rate limiting (5 login attempts/min/IP)
 * - Generic error messages (no user enumeration)
 * - HttpOnly cookies (XSS protection)
 * - Secure flag in production (HTTPS only)
 * - SameSite cookies (CSRF protection)
 */

/**
 * POST /auth/register - Register new user
 * 
 * Alias for POST /users endpoint for better REST semantics
 */
router.post(
  '/register',
  publicRateLimiter,
  upload.single('profilePhoto'),
  handleUploadError,
  cleanupOnError,
  validateRequest(createUserSchema, 'body'),
  userController.register.bind(userController)
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User login (session creation)
 *     description: |
 *       Authenticates user and sets httpOnly cookie with JWT.
 *       
 *       **Security**:
 *       - Rate limited (5 attempts/min/IP)
 *       - Generic error messages (no user enumeration)
 *       - HttpOnly cookie (XSS protection)
 *       - Secure flag in production
 *       - SameSite cookie (CSRF protection)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - corporateEmail
 *               - password
 *             properties:
 *               corporateEmail:
 *                 type: string
 *                 format: email
 *                 example: "jdoe@unisabana.edu.co"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "YourPassword123!"
 *           examples:
 *             passenger:
 *               summary: Passenger login
 *               value:
 *                 corporateEmail: "passenger@unisabana.edu.co"
 *                 password: "SecurePass123!"
 *             driver:
 *               summary: Driver login
 *               value:
 *                 corporateEmail: "driver@unisabana.edu.co"
 *                 password: "SecurePass123!"
 *     responses:
 *       200:
 *         description: Login successful, session cookie set
 *         headers:
 *           Set-Cookie:
 *             description: JWT access token
 *             schema:
 *               type: string
 *               example: "access_token=eyJ...; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=7200"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "665e2a...f1"
 *                 role:
 *                   type: string
 *                   enum: [passenger, driver]
 *                   example: "driver"
 *                 firstName:
 *                   type: string
 *                   example: "John"
 *                 lastName:
 *                   type: string
 *                   example: "Doe"
 *             examples:
 *               success:
 *                 summary: Successful login
 *                 value:
 *                   id: "665e2a...f1"
 *                   role: "driver"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             example:
 *               code: "invalid_schema"
 *               message: "Validation failed"
 *               details:
 *                 - field: "corporateEmail"
 *                   issue: "corporateEmail must be a valid email address"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "invalid_credentials"
 *                 message:
 *                   type: string
 *                   example: "Email or password is incorrect"
 *                 correlationId:
 *                   type: string
 *             example:
 *               code: "invalid_credentials"
 *               message: "Email or password is incorrect"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       429:
 *         description: Too many login attempts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "too_many_attempts"
 *                 message:
 *                   type: string
 *                   example: "Too many login attempts, try again later"
 *             example:
 *               code: "too_many_attempts"
 *               message: "Too many login attempts, try again later"
 */
router.post(
  '/login',
  loginRateLimiter,                  // Rate limit: 5/min/IP
  validateRequest(loginSchema),      // Validate email/password format
  authController.login.bind(authController)
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User logout (session destruction)
 *     description: |
 *       Clears the httpOnly cookie to revoke the session.
 *       
 *       **Idempotent**: Can be called with or without authentication.
 *       
 *       **Cookie Removal**: Sets access_token cookie with Max-Age=0 and matching attributes.
 *     responses:
 *       200:
 *         description: Logout successful, cookie cleared
 *         headers:
 *           Set-Cookie:
 *             description: Clear access_token cookie
 *             schema:
 *               type: string
 *               example: "access_token=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *             example:
 *               ok: true
 */
router.post(
  '/logout',
  authController.logout.bind(authController)
);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Get current user session/identity
 *     description: |
 *       Returns minimal user identity for session verification.
 *       
 *       **Protected**: Requires valid JWT cookie (set by /auth/login).
 *       
 *       **Security**:
 *       - No secrets or internal fields exposed
 *       - Cache-Control: no-store (never cache)
 *       - PII redaction in logs
 *       - Correlation ID for observability
 *       
 *       **Use case**: Client renders protected UI without re-login
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current user identity
 *         headers:
 *           Cache-Control:
 *             description: Prevent caching of sensitive data
 *             schema:
 *               type: string
 *               example: "no-store"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "665e2a...f1"
 *                 role:
 *                   type: string
 *                   enum: [passenger, driver]
 *                   example: "driver"
 *                 firstName:
 *                   type: string
 *                   example: "John"
 *                 lastName:
 *                   type: string
 *                   example: "Doe"
 *                 driver:
 *                   type: object
 *                   description: Only present for drivers
 *                   properties:
 *                     hasVehicle:
 *                       type: boolean
 *                       example: true
 *             examples:
 *               driver_with_vehicle:
 *                 summary: Driver with vehicle
 *                 value:
 *                   id: "665e2a...f1"
 *                   role: "driver"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                   driver:
 *                     hasVehicle: true
 *               driver_without_vehicle:
 *                 summary: Driver without vehicle
 *                 value:
 *                   id: "665e2a...f2"
 *                   role: "driver"
 *                   firstName: "Jane"
 *                   lastName: "Smith"
 *                   driver:
 *                     hasVehicle: false
 *               passenger:
 *                 summary: Passenger
 *                 value:
 *                   id: "665e2a...f3"
 *                   role: "passenger"
 *                   firstName: "Alice"
 *                   lastName: "Johnson"
 *       401:
 *         description: Missing or invalid session
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "unauthorized"
 *                 message:
 *                   type: string
 *                   example: "Missing or invalid session"
 *                 correlationId:
 *                   type: string
 *             example:
 *               code: "unauthorized"
 *               message: "Missing or invalid session"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.get(
  '/me',
  authenticate,
  authController.getMe.bind(authController)
);

/**
 * @openapi
 * /auth/password/reset-request:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request password reset
 *     description: |
 *       Initiates a password reset process for a user (out-of-session).
 *       
 *       **Security**:
 *       - Generic 200 response (never reveals if email exists)
 *       - Rate limited (3 requests per 15 min per IP)
 *       - PII redaction in logs (email never logged)
 *       - Cryptographically secure token (32 bytes random)
 *       - Token expires in 15 minutes
 *       - One-time use token (consumed after reset)
 *       
 *       **Flow**:
 *       1. User provides email
 *       2. If account exists: token generated and sent via email
 *       3. If account doesn't exist: generic success (no enumeration)
 *       4. User receives email with reset link (MVP: check server logs)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - corporateEmail
 *             properties:
 *               corporateEmail:
 *                 type: string
 *                 format: email
 *                 example: "jdoe@unisabana.edu.co"
 *           examples:
 *             request:
 *               summary: Password reset request
 *               value:
 *                 corporateEmail: "jdoe@unisabana.edu.co"
 *     responses:
 *       200:
 *         description: |
 *           Generic success response (always returned).
 *           
 *           Note: Response is intentionally generic to prevent user enumeration.
 *           If the email exists, a reset token is generated and sent.
 *           If the email doesn't exist, the same response is returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *             example:
 *               ok: true
 *       400:
 *         description: Validation error (invalid email format)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             example:
 *               code: "invalid_schema"
 *               message: "Validation failed"
 *               details:
 *                 - field: "corporateEmail"
 *                   issue: "corporateEmail must be a valid email address"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "too_many_attempts"
 *                 message:
 *                   type: string
 *                   example: "Please try again later"
 *             example:
 *               code: "too_many_attempts"
 *               message: "Please try again later"
 */
router.post(
  '/password/reset-request',
  passwordResetRateLimiter,
  validateRequest(passwordResetRequestSchema),
  authController.requestPasswordReset.bind(authController)
);

/**
 * @openapi
 * /auth/password/reset:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Reset password using token (out-of-session)
 *     description: |
 *       Redeems a password reset token to set a new password.
 *       
 *       **Token Validation**:
 *       - Token is hashed (SHA-256) before lookup
 *       - Checked against database hash (constant-time comparison)
 *       - Must not be expired (15-minute window)
 *       - Must not be already consumed (one-time use)
 *       
 *       **Password Requirements**:
 *       - Minimum 8 characters
 *       - At least one uppercase letter
 *       - At least one lowercase letter
 *       - At least one number
 *       - At least one special character (@$!%*?&)
 *       
 *       **Security**:
 *       - New password is hashed with bcrypt before storage
 *       - Token is marked as consumed (one-time use)
 *       - passwordChangedAt timestamp is updated
 *       - All operations are logged without sensitive data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 description: Base64url-encoded token from reset email
 *                 pattern: '^[A-Za-z0-9_-]+$'
 *                 minLength: 43
 *                 example: "abc123XYZ-_token_from_email_url"
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 maxLength: 128
 *                 description: Strong password meeting complexity requirements
 *                 example: "NewSecurePass123!"
 *           examples:
 *             valid:
 *               summary: Valid reset request
 *               value:
 *                 token: "k7n3R9xZ2pQ8vM5wL1jT4hG6fD0sA9cB2eN8uY7iO3qW5rT1xK4mP6vL2jH9gF0"
 *                 newPassword: "NewSecurePass123!"
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *             example:
 *               ok: true
 *       400:
 *         description: Invalid token or validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   enum: [invalid_schema, invalid_token]
 *                 message:
 *                   type: string
 *                 correlationId:
 *                   type: string
 *             examples:
 *               invalid_token:
 *                 summary: Invalid or not found token
 *                 value:
 *                   code: "invalid_token"
 *                   message: "The reset link is invalid"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               invalid_schema:
 *                 summary: Validation error
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "newPassword"
 *                       issue: "newPassword must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       409:
 *         description: Token already used
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "token_used"
 *                 message:
 *                   type: string
 *                   example: "The reset link has already been used"
 *                 correlationId:
 *                   type: string
 *             example:
 *               code: "token_used"
 *               message: "The reset link has already been used"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       410:
 *         description: Token expired
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "token_expired"
 *                 message:
 *                   type: string
 *                   example: "The reset link has expired"
 *                 correlationId:
 *                   type: string
 *             example:
 *               code: "token_expired"
 *               message: "The reset link has expired"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.post(
  '/password/reset',
  validateRequest(passwordResetSchema),
  authController.resetPassword.bind(authController)
);

/**
 * @openapi
 * /auth/password:
 *   patch:
 *     tags:
 *       - Authentication
 *     summary: Change password (in-session, authenticated)
 *     description: |
 *       Allows authenticated users to change their password by providing
 *       current password and a new strong password.
 *       
 *       **Authentication Required**: Must have valid JWT cookie from /auth/login
 *       
 *       **Password Verification**:
 *       - Current password verified with bcrypt (timing-safe)
 *       - If current password wrong → 401 invalid_credentials
 *       
 *       **New Password Requirements**:
 *       - Minimum 8 characters
 *       - At least one uppercase letter
 *       - At least one lowercase letter
 *       - At least one number
 *       - At least one special character (@$!%*?&)
 *       
 *       **Security**:
 *       - New password hashed with bcrypt before storage
 *       - passwordChangedAt timestamp updated
 *       - All operations logged without passwords
 *       - Session remains valid after password change
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *                 description: Current password for verification
 *                 example: "OldSecret123"
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 maxLength: 128
 *                 description: New strong password meeting complexity requirements
 *                 example: "CorrectHorseBatteryStaple!"
 *           examples:
 *             valid:
 *               summary: Valid password change
 *               value:
 *                 currentPassword: "OldSecret123"
 *                 newPassword: "NewSecurePass123!"
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *             example:
 *               ok: true
 *       400:
 *         description: Validation error (weak new password)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             example:
 *               code: "invalid_schema"
 *               message: "Validation failed"
 *               details:
 *                 - field: "newPassword"
 *                   issue: "newPassword must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Authentication failed or current password incorrect
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   enum: [unauthorized, invalid_credentials]
 *                 message:
 *                   type: string
 *                 correlationId:
 *                   type: string
 *             examples:
 *               invalid_credentials:
 *                 summary: Wrong current password
 *                 value:
 *                   code: "invalid_credentials"
 *                   message: "Email or password is incorrect"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               unauthorized:
 *                 summary: Not authenticated
 *                 value:
 *                   code: "unauthorized"
 *                   message: "Authentication required"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.patch(
  '/password',
  authenticate,  // Require authentication
  validateRequest(passwordChangeSchema),
  authController.changePassword.bind(authController)
);

module.exports = router;

