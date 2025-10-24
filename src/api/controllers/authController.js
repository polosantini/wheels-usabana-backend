/**
 * Auth Controller
 * 
 * Handles authentication endpoints:
 * - POST /auth/login - Create session (set JWT cookie)
 * - POST /auth/logout - Destroy session (clear cookie)
 * - GET /auth/me - Get current user session/identity
 * - POST /auth/password/reset-request - Request password reset
 */

const AuthService = require('../../domain/services/AuthService');
const MongoUserRepository = require('../../infrastructure/repositories/MongoUserRepository');
const MongoVehicleRepository = require('../../infrastructure/repositories/MongoVehicleRepository');
const MongoPasswordResetTokenRepository = require('../../infrastructure/repositories/PasswordResetTokenRepository');
const { generateCsrfToken, setCsrfCookie, clearCsrfCookie } = require('../../utils/csrf');

class AuthController {
  constructor() {
    this.authService = new AuthService();
    this.userRepository = new MongoUserRepository();
    this.vehicleRepository = new MongoVehicleRepository();
    this.tokenRepository = new MongoPasswordResetTokenRepository();
  }

  /**
   * POST /auth/login
   * 
   * Authenticates user and sets httpOnly cookie with JWT
   * 
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} next - Next middleware
   * 
   * Request body:
   * {
   *   "corporateEmail": "user@unisabana.edu.co",
   *   "password": "password123"
   * }
   * 
   * Response 200:
   * {
   *   "id": "665e2a...f1",
   *   "role": "driver",
   *   "firstName": "John",
   *   "lastName": "Doe"
   * }
   * 
   * Errors:
   * - 401 invalid_credentials: Invalid email or password
   * - 500 internal_error: Unexpected server error
   * 
   * Security:
   * - Generic error message (no user enumeration)
   * - No PII logged
   * - Rate limited by IP and email
   */
  async login(req, res, next) {
    try {
      const { corporateEmail, password } = req.body;

      // Log login attempt WITHOUT credentials
      console.log(`[AuthController] Login attempt for email domain: ${corporateEmail?.split('@')[1] || 'unknown'} | IP: ${req.ip} | correlationId: ${req.correlationId}`);

      // Authenticate user via AuthService
      const { user, token } = await this.authService.authenticateUser(
        this.userRepository,
        corporateEmail,
        password
      );

      // Set httpOnly cookie with JWT
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieMaxAge = 2 * 60 * 60 * 1000; // 2 hours (matches JWT expiry)

      res.cookie('access_token', token, {
        httpOnly: true,              // CRITICAL: Prevents XSS attacks (JS cannot read)
        secure: true,                // Always require HTTPS (Vercel uses HTTPS)
        sameSite: 'none',            // Allow cross-site cookies (required for different Vercel domains)
        maxAge: cookieMaxAge,
        path: '/'                    // Available to all routes
      });

      // Generate and set CSRF token (double-submit cookie pattern)
      // This provides additional CSRF protection for state-changing routes
      const csrfToken = generateCsrfToken();
      setCsrfCookie(res, csrfToken);

      // Log successful login WITHOUT PII
      console.log(`[AuthController] Login successful | userId: ${user.id} | role: ${user.role} | correlationId: ${req.correlationId}`);

      // Return minimal DTO (no password or sensitive fields)
      const response = {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName
      };
      
      // Debug log (remove after testing)
      console.log('[AuthController] Response body:', response);
      
      res.status(200).json(response);

    } catch (error) {
      // Handle invalid credentials
      if (error.code === 'invalid_credentials') {
        // Log failed attempt WITHOUT revealing if user exists
        console.log(`[AuthController] Login failed | reason: invalid_credentials | IP: ${req.ip} | correlationId: ${req.correlationId}`);
        
        return res.status(401).json({
          code: 'invalid_credentials',
          message: 'Email or password is incorrect',
          correlationId: req.correlationId
        });
      }

      // Log internal errors WITHOUT details
      console.error(`[AuthController] Login error | correlationId: ${req.correlationId}`);

      // Generic error for client
      return res.status(500).json({
        code: 'internal_error',
        message: 'An error occurred during login',
        correlationId: req.correlationId
      });
    }
  }

  /**
   * POST /auth/logout
   * 
   * Clears the access_token cookie (session revocation)
   * Idempotent: Can be called with or without a valid session
   * 
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * 
   * Response 200:
   * {
   *   "ok": true
   * }
   * 
   * Cookie is cleared with Max-Age=0 and matching attributes:
   * - HttpOnly (XSS protection)
   * - Secure (HTTPS only in production)
   * - SameSite (CSRF protection)
   * - Path=/ (matches login cookie)
   */
  logout(req, res) {
    // Log logout WITHOUT user details (if authenticated, req.user would be available)
    const userId = req.user?.id || req.user?.sub || 'anonymous';
    console.log(`[AuthController] Logout | userId: ${userId} | correlationId: ${req.correlationId}`);

    // Clear the access_token cookie with EXACT same attributes as when set
    // This is critical for the cookie to be properly removed
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/'
    });

    // Also clear CSRF token cookie
    clearCsrfCookie(res);

    res.status(200).json({
      ok: true
    });
  }

  /**
   * GET /auth/me
   * 
   * Returns minimal user identity for session verification
   * Protected by authenticate middleware (requires valid JWT cookie)
   * 
   * @param {Object} req - Express request (req.user set by authenticate middleware)
   * @param {Object} res - Express response
   * 
   * Response 200:
   * {
   *   "id": "665e2a...f1",
   *   "role": "driver",
   *   "firstName": "John",
   *   "lastName": "Doe",
   *   "driver": { "hasVehicle": true }  // only for drivers
   * }
   * 
   * Errors:
   * - 401 unauthorized: Missing or invalid session (handled by authenticate middleware)
   * - 500 internal_error: Unexpected server error
   * 
   * Security:
   * - No secrets or internal fields exposed
   * - Cache-Control: no-store (never cache sensitive data)
   * - PII redaction in logs (never log email or tokens)
   * - Correlation ID for observability
   */
  async getMe(req, res) {
    try {
      // req.user is set by authenticate middleware
      // Shape: { id, sub, role, email, iat, exp }
      const userId = req.user.id;

      // Log request WITHOUT PII
      console.log(`[AuthController] GET /auth/me | userId: ${userId} | role: ${req.user.role} | correlationId: ${req.correlationId}`);

      // Fetch minimal user profile with hasVehicle flag
      const profile = await this.authService.getCurrentUserProfile(
        this.userRepository,
        this.vehicleRepository,
        userId
      );

      // Set Cache-Control to prevent caching of sensitive data
      res.set('Cache-Control', 'no-store');

      // Log successful response WITHOUT PII
      console.log(`[AuthController] GET /auth/me success | userId: ${userId} | correlationId: ${req.correlationId}`);

      res.status(200).json(profile);

    } catch (error) {
      // Handle user not found (should not happen with valid JWT)
      if (error.code === 'user_not_found') {
        console.error(`[AuthController] User not found (orphaned JWT?) | userId: ${req.user?.id} | correlationId: ${req.correlationId}`);
        
        return res.status(401).json({
          code: 'unauthorized',
          message: 'Missing or invalid session',
          correlationId: req.correlationId
        });
      }

      // Log internal errors WITHOUT details
      console.error(`[AuthController] GET /auth/me error | userId: ${req.user?.id} | correlationId: ${req.correlationId}`);

      // Generic error for client
      return res.status(500).json({
        code: 'internal_error',
        message: 'An error occurred while fetching profile',
        correlationId: req.correlationId
      });
    }
  }

  /**
   * POST /auth/password/reset-request
   * 
   * Request password reset (out-of-session)
   * 
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * 
   * Request body:
   * {
   *   "corporateEmail": "user@unisabana.edu.co"
   * }
   * 
   * Response 200 (always):
   * {
   *   "ok": true
   * }
   * 
   * Errors:
   * - 400 invalid_schema: Invalid email format
   * - 429 too_many_attempts: Rate limit exceeded
   * 
   * Security:
   * - Generic 200 response (never reveals if email exists)
   * - Rate limited (3 requests per 15 min per IP)
   * - PII redaction in logs (never log email)
   * - Token dispatched via email (MVP: logged for testing)
   */
  async requestPasswordReset(req, res) {
    try {
      const { corporateEmail } = req.body;
      const clientIp = req.ip;
      const userAgent = req.get('User-Agent') || 'unknown';

      // Log request WITHOUT email (PII redaction)
      console.log(`[AuthController] Password reset requested | emailDomain: ${corporateEmail?.split('@')[1] || 'unknown'} | IP: ${clientIp} | correlationId: ${req.correlationId}`);

      // Request reset from AuthService (now with token repository)
      const result = await this.authService.requestPasswordReset(
        this.userRepository,
        this.tokenRepository,
        corporateEmail,
        clientIp,
        userAgent
      );

      // If token was generated (user exists), log it for MVP
      // Production: Dispatch email via queue/service
      if (result.token) {
        const resetUrl = `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/reset-password?token=${result.token}`;
        
        // MVP: Log reset URL (remove in production)
        console.log(`[AuthController] Password reset URL generated | userId: ${result.user.id} | correlationId: ${req.correlationId}`);
        console.log(`[AuthController] Reset URL (MVP only): ${resetUrl}`);
        
        // TODO: Production - Queue email
        // await emailQueue.add('password-reset', {
        //   email: result.user.email,
        //   firstName: result.user.firstName,
        //   resetUrl,
        //   expiresIn: '15 minutes'
        // });
      }

      // CRITICAL: Always return 200 with generic message
      // Never reveal if email exists
      res.status(200).json({
        ok: true
      });

    } catch (error) {
      // Log internal errors WITHOUT PII
      console.error(`[AuthController] Password reset request error | IP: ${req.ip} | correlationId: ${req.correlationId}`);

      // Generic error for client
      return res.status(500).json({
        code: 'internal_error',
        message: 'An error occurred while processing your request',
        correlationId: req.correlationId
      });
    }
  }

  /**
   * POST /auth/password/reset
   * 
   * Redeems reset token and sets new password (out-of-session)
   * 
   * Request Body:
   * {
   *   "token": "base64url_token_from_email",
   *   "newPassword": "StrongPassword123!"
   * }
   * 
   * Response 200 (Success):
   * {
   *   "ok": true
   * }
   * 
   * Error Responses:
   * - 400 invalid_token: Token not found or invalid
   * - 410 token_expired: Token has expired
   * - 409 token_used: Token already consumed
   * 
   * Security:
   * - Token is hashed before lookup (SHA-256)
   * - Constant-time token comparison
   * - Token marked as consumed (one-time use)
   * - Password hashed with bcrypt before storage
   * - Never logs passwords or tokens
   */
  async resetPassword(req, res) {
    try {
      const { token, newPassword } = req.body;
      const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

      // Log attempt WITHOUT sensitive data
      console.log(`[AuthController] Password reset attempt | IP: ${clientIp} | correlationId: ${req.correlationId}`);

      // Perform password reset via AuthService (now with token repository)
      await this.authService.resetPassword(
        this.userRepository,
        this.tokenRepository,
        token,
        newPassword,
        clientIp
      );

      // Success
      console.log(`[AuthController] Password reset successful | IP: ${clientIp} | correlationId: ${req.correlationId}`);
      
      res.status(200).json({
        ok: true
      });

    } catch (error) {
      // Handle specific error codes
      if (error.code && error.statusCode) {
        console.log(`[AuthController] Password reset failed | code: ${error.code} | IP: ${req.ip} | correlationId: ${req.correlationId}`);
        
        return res.status(error.statusCode).json({
          code: error.code,
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Log internal errors
      console.error(`[AuthController] Password reset error | IP: ${req.ip} | correlationId: ${req.correlationId}`);

      // Generic error for client
      return res.status(500).json({
        code: 'internal_error',
        message: 'An error occurred while resetting your password',
        correlationId: req.correlationId
      });
    }
  }

  /**
   * PATCH /auth/password
   * 
   * Changes authenticated user's password (in-session)
   * 
   * Request Body:
   * {
   *   "currentPassword": "OldSecret123",
   *   "newPassword": "CorrectHorseBatteryStaple!"
   * }
   * 
   * Response 200 (Success):
   * {
   *   "ok": true
   * }
   * 
   * Error Responses:
   * - 401 invalid_credentials: Current password is incorrect
   * - 400 invalid_schema: Validation error (weak password)
   * 
   * Security:
   * - Requires authentication (JWT cookie)
   * - Current password verified with bcrypt
   * - New password hashed before storage
   * - Never logs passwords
   * 
   * Note: Requires authenticate middleware
   */
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user?.id || req.user?.sub;
      const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

      // Verify user is authenticated (should be guaranteed by middleware)
      if (!userId) {
        console.error(`[AuthController] Password change without userId | correlationId: ${req.correlationId}`);
        return res.status(401).json({
          code: 'unauthorized',
          message: 'Authentication required',
          correlationId: req.correlationId
        });
      }

      // Log attempt WITHOUT passwords
      console.log(`[AuthController] Password change attempt | userId: ${userId} | IP: ${clientIp} | correlationId: ${req.correlationId}`);

      // Perform password change via AuthService
      await this.authService.changePassword(
        this.userRepository,
        userId,
        currentPassword,
        newPassword,
        clientIp
      );

      // Success
      console.log(`[AuthController] Password changed successfully | userId: ${userId} | IP: ${clientIp} | correlationId: ${req.correlationId}`);
      
      res.status(200).json({
        ok: true
      });

    } catch (error) {
      // Handle specific error codes
      if (error.code && error.statusCode) {
        const userId = req.user?.id || req.user?.sub || 'unknown';
        console.log(`[AuthController] Password change failed | userId: ${userId} | code: ${error.code} | IP: ${req.ip} | correlationId: ${req.correlationId}`);
        
        return res.status(error.statusCode).json({
          code: error.code,
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Log internal errors
      console.error(`[AuthController] Password change error | IP: ${req.ip} | correlationId: ${req.correlationId}`);

      // Generic error for client
      return res.status(500).json({
        code: 'internal_error',
        message: 'An error occurred while changing your password',
        correlationId: req.correlationId
      });
    }
  }
}

module.exports = AuthController;

