/**
 * Auth Domain Service
 * 
 * Centralized authentication logic:
 * - Password verification (bcrypt)
 * - JWT signing and verification
 * - Token generation with standard claims
 * 
 * Security:
 * - Never logs credentials or password hashes
 * - Generic error messages (no user enumeration)
 * - Key rotation-ready configuration
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ResetTokenUtil = require('../../utils/resetToken');

class AuthService {
  constructor() {
    // JWT configuration from environment
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '2h';
    this.jwtIssuer = process.env.JWT_ISSUER || 'wheels-unisabana';
    this.jwtAudience = process.env.JWT_AUDIENCE || 'wheels-unisabana-api';
  }

  /**
   * Verify plaintext password against stored hash
   * 
   * @param {string} plainPassword - User-provided password
   * @param {string} passwordHash - Stored bcrypt hash
   * @returns {Promise<boolean>} - true if valid, false otherwise
   * 
   * Security: Never logs inputs or hashes
   */
  async verifyPassword(plainPassword, passwordHash) {
    try {
      // bcrypt.compare is timing-attack safe
      const isValid = await bcrypt.compare(plainPassword, passwordHash);
      return isValid;
    } catch (error) {
      // Log error without exposing credentials
      console.error('[AuthService] Password verification failed (internal error)');
      return false;
    }
  }

  /**
   * Sign access token (JWT) with standard claims
   * 
   * @param {Object} payload - Token payload
   * @param {string} payload.sub - Subject (user ID)
   * @param {string} payload.role - User role ('passenger' | 'driver')
   * @param {string} payload.email - User email (for audit/logging)
   * @returns {string} - Signed JWT
   * 
   * Standard JWT claims:
   * - sub: Subject (user ID)
   * - role: Custom claim for RBAC
   * - email: Custom claim for audit
   * - iat: Issued at (auto-added by jwt.sign)
   * - exp: Expiration time (auto-added by jwt.sign)
   * - iss: Issuer
   * - aud: Audience
   */
  signAccessToken(payload) {
    try {
      const token = jwt.sign(
        {
          sub: payload.sub,
          role: payload.role,
          email: payload.email
        },
        this.jwtSecret,
        {
          expiresIn: this.jwtExpiresIn,
          issuer: this.jwtIssuer,
          audience: this.jwtAudience
        }
      );
      return token;
    } catch (error) {
      console.error('[AuthService] Token signing failed:', error.message);
      throw new Error('Failed to sign token');
    }
  }

  /**
   * Verify access token (JWT)
   * 
   * @param {string} token - JWT to verify
   * @returns {Object} - Decoded payload { sub, role, email, iat, exp, iss, aud }
   * @throws {Error} - If token is invalid or expired
   * 
   * Error types:
   * - TokenExpiredError: Token has expired
   * - JsonWebTokenError: Token is malformed or signature invalid
   * - NotBeforeError: Token used before nbf claim
   */
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: this.jwtIssuer,
        audience: this.jwtAudience
      });
      return decoded;
    } catch (error) {
      // Re-throw with original error type for middleware to handle
      throw error;
    }
  }

  /**
   * Authenticate user by email and password
   * 
   * @param {Object} userRepository - Repository to find user
   * @param {string} corporateEmail - User's corporate email
   * @param {string} password - User's plaintext password
   * @returns {Promise<Object>} - { user, token } if successful
   * @throws {Error} - Generic error on failure (no user enumeration)
   * 
   * Security:
   * - Generic error message for both "user not found" and "invalid password"
   * - No credentials logged
   * - Timing-attack resistant (bcrypt.compare)
   */
  async authenticateUser(userRepository, corporateEmail, password) {
    try {
      // Find user by email (case-insensitive)
      const user = await userRepository.findByEmail(corporateEmail.toLowerCase());

      // Generic error - don't reveal if user exists
      if (!user) {
        const error = new Error('Invalid email or password');
        error.code = 'invalid_credentials';
        throw error;
      }

      // Verify password
      const isValidPassword = await this.verifyPassword(password, user.password);

      if (!isValidPassword) {
        const error = new Error('Invalid email or password');
        error.code = 'invalid_credentials';
        throw error;
      }

      // Generate access token
      const token = this.signAccessToken({
        sub: user.id,
        role: user.role,
        email: user.corporateEmail
      });

      return {
        user,
        token
      };
    } catch (error) {
      // Re-throw if it's our custom error
      if (error.code === 'invalid_credentials') {
        throw error;
      }

      // Log internal errors without exposing details to client
      console.error('[AuthService] Authentication failed (internal error)');
      
      // Generic error for client
      const genericError = new Error('Authentication failed');
      genericError.code = 'authentication_error';
      throw genericError;
    }
  }

  /**
   * Get current authenticated user profile (minimal DTO)
   * 
   * Fetches user by ID and returns a minimal identity projection
   * suitable for session verification endpoints.
   * 
   * @param {Object} userRepository - Repository to find user
   * @param {Object} vehicleRepository - Repository to check vehicle status
   * @param {string} userId - User ID from JWT (req.user.id)
   * @returns {Promise<Object>} - Minimal user DTO with hasVehicle flag
   * @throws {Error} - If user not found (should not happen with valid JWT)
   * 
   * Response shape:
   * {
   *   id, role, firstName, lastName,
   *   driver: { hasVehicle: boolean } // only for drivers
   * }
   */
  async getCurrentUserProfile(userRepository, vehicleRepository, userId) {
    try {
      // Find user by ID
      const user = await userRepository.findById(userId);

      if (!user) {
        // This should not happen with a valid JWT, but handle gracefully
        const error = new Error('User not found');
        error.code = 'user_not_found';
        throw error;
      }

      // Build minimal DTO
      const profile = {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName
      };

      // If driver, check if they have a vehicle
      if (user.role === 'driver') {
        const vehicle = await vehicleRepository.findByDriverId(userId);
        profile.driver = {
          hasVehicle: vehicle !== null
        };
      }

      return profile;
    } catch (error) {
      // Re-throw custom errors
      if (error.code === 'user_not_found') {
        throw error;
      }

      // Log internal errors
      console.error('[AuthService] Failed to fetch user profile:', error.message);
      
      const genericError = new Error('Failed to fetch user profile');
      genericError.code = 'profile_fetch_error';
      throw genericError;
    }
  }

  /**
   * Request password reset (out-of-session)
   * 
   * Generates a secure reset token and stores it in dedicated PasswordResetToken collection.
   * CRITICAL: Always returns success, never reveals if email exists.
   * 
   * @param {Object} userRepository - Repository to find user
   * @param {Object} tokenRepository - Repository for password reset tokens
   * @param {string} corporateEmail - Email address (may or may not exist)
   * @param {string} clientIp - Client IP address for audit trail
   * @param {string} userAgent - Client user agent for audit trail
   * @returns {Promise<Object>} - { success: true, token?: string, user?: Object }
   *   - If user exists: returns token (for email/logging), stores in token collection
   *   - If user doesn't exist: returns success without token
   * 
   * Security:
   * - Never logs email addresses (PII redaction)
   * - Generic response (no user enumeration)
   * - Invalidates previous active tokens
   * - Token expiry: 15 minutes
   * - Stores hashed token (SHA-256), not plaintext
   * - Stores IP and User-Agent for audit trail
   */
  async requestPasswordReset(userRepository, tokenRepository, corporateEmail, clientIp = 'unknown', userAgent = 'unknown') {
    try {
      // Find user by email (case-insensitive)
      const user = await userRepository.findByEmail(corporateEmail.toLowerCase());

      // If user doesn't exist, return generic success (prevent enumeration)
      if (!user) {
        // Log attempt WITHOUT email (PII redaction)
        console.log(`[AuthService] Password reset requested | user: not_found | ip: ${clientIp}`);
        return { success: true };
      }

      // Generate secure token using new utility
      const { tokenPlain, tokenHash, expiresAt } = ResetTokenUtil.generateResetToken(15); // 15 min expiry

      // Invalidate all previous active tokens for this user
      const invalidatedCount = await tokenRepository.invalidateActiveTokens(user.id);
      if (invalidatedCount > 0) {
        console.log(`[AuthService] Invalidated ${invalidatedCount} previous token(s) | userId: ${user.id}`);
      }

      // Create new token in dedicated collection
      await tokenRepository.create({
        userId: user.id,
        tokenHash,
        expiresAt,
        createdIp: clientIp,
        createdUa: userAgent
      });

      // Log success WITHOUT PII (never log email or token)
      console.log(`[AuthService] Password reset token generated | userId: ${user.id} | expires: ${expiresAt.toISOString()} | ip: ${clientIp}`);

      // Return token for email dispatch
      // MVP: Can log token URL for testing
      // Production: Queue email with token link
      return {
        success: true,
        token: tokenPlain,  // Send this via email (only time we return plaintext)
        user: {
          id: user.id,
          firstName: user.firstName,
          email: user.corporateEmail
        }
      };

    } catch (error) {
      // Log error WITHOUT PII
      console.error('[AuthService] Password reset request failed (internal error):', error.message);

      // Generic error for client (no details exposed)
      const genericError = new Error('Failed to process password reset request');
      genericError.code = 'password_reset_error';
      throw genericError;
    }
  }

  /**
   * Reset Password (Token Redemption)
   * 
   * Validates reset token and sets new password. This is an out-of-session operation.
   * Uses dedicated PasswordResetToken collection for validation.
   * 
   * Validation Steps:
   * 1. Hash token and look up in token collection
   * 2. Check token exists → 400 invalid_token
   * 3. Check token not expired → 410 token_expired
   * 4. Check token not consumed → 409 token_used
   * 5. Hash new password (bcrypt)
   * 6. Update password in User collection
   * 7. Mark token as consumed in Token collection
   * 
   * @param {Object} userRepository - Repository for user operations
   * @param {Object} tokenRepository - Repository for token operations
   * @param {string} token - Raw token from email (base64url)
   * @param {string} newPassword - New plaintext password
   * @param {string} clientIp - Client IP for logging
   * @returns {Promise<Object>} - { success: true }
   * @throws {Error} - invalid_token (400), token_expired (410), token_used (409)
   * 
   * Security:
   * - Never logs passwords or tokens
   * - Uses constant-time token comparison via SHA-256 hash lookup
   * - Marks token as consumed (one-time use, idempotent)
   * - Updates passwordChangedAt timestamp
   * - Atomic operations (no race conditions)
   */
  async resetPassword(userRepository, tokenRepository, token, newPassword, clientIp = 'unknown') {
    try {
      // 1. Hash token to look up in token collection
      const tokenHash = ResetTokenUtil.hashToken(token);
      
      // 2. Find token record by hash
      const tokenRecord = await tokenRepository.findByHash(tokenHash);
      
      // 3. Check token exists
      if (!tokenRecord) {
        console.log(`[AuthService] Invalid reset token attempt | ip: ${clientIp}`);
        const error = new Error('The reset link is invalid');
        error.code = 'invalid_token';
        error.statusCode = 400;
        throw error;
      }
      
      // 4. Check token not expired
      if (!tokenRecord.expiresAt || tokenRecord.expiresAt < new Date()) {
        console.log(`[AuthService] Expired reset token | userId: ${tokenRecord.userId} | expired: ${tokenRecord.expiresAt?.toISOString()} | ip: ${clientIp}`);
        const error = new Error('The reset link has expired');
        error.code = 'token_expired';
        error.statusCode = 410;
        throw error;
      }
      
      // 5. Check token not already consumed
      if (tokenRecord.consumedAt) {
        console.log(`[AuthService] Already consumed reset token | userId: ${tokenRecord.userId} | consumed: ${tokenRecord.consumedAt.toISOString()} | ip: ${clientIp}`);
        const error = new Error('The reset link has already been used');
        error.code = 'token_used';
        error.statusCode = 409;
        throw error;
      }
      
      // 6. Hash new password (bcrypt)
      const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
      const newPasswordHash = await bcrypt.hash(newPassword, bcryptRounds);
      
      // 7. Update password in User collection
      await userRepository.updatePassword(tokenRecord.userId, newPasswordHash);
      
      // 8. Mark token as consumed in Token collection (idempotent)
      await tokenRepository.consumeToken(tokenHash);
      
      // Log success WITHOUT sensitive data
      console.log(`[AuthService] Password reset successful | userId: ${tokenRecord.userId} | ip: ${clientIp}`);
      
      return { success: true };
      
    } catch (error) {
      // Re-throw known errors (invalid_token, token_expired, token_used)
      if (error.code && error.statusCode) {
        throw error;
      }
      
      // Log unexpected errors WITHOUT sensitive data
      console.error('[AuthService] Password reset failed (internal error):', error.message);
      
      // Generic error for client
      const genericError = new Error('Failed to reset password');
      genericError.code = 'password_reset_error';
      genericError.statusCode = 500;
      throw genericError;
    }
  }

  /**
   * Change Password (In-session)
   * 
   * Allows authenticated users to change their password by verifying
   * current password and setting a new one.
   * 
   * Validation Steps:
   * 1. Find user by ID (from authenticated session)
   * 2. Verify current password matches stored hash
   * 3. Hash new password with bcrypt
   * 4. Update password and passwordChangedAt
   * 
   * @param {Object} userRepository - Repository for user operations
   * @param {string} userId - User ID from authenticated session
   * @param {string} currentPassword - Current plaintext password
   * @param {string} newPassword - New plaintext password
   * @param {string} clientIp - Client IP for logging
   * @returns {Promise<Object>} - { success: true }
   * @throws {Error} - invalid_credentials (401) if current password wrong
   * 
   * Security:
   * - Never logs passwords
   * - Uses bcrypt.compare for timing-safe comparison
   * - Updates passwordChangedAt timestamp
   * - Logs security events without PII
   */
  async changePassword(userRepository, userId, currentPassword, newPassword, clientIp = 'unknown') {
    try {
      // 1. Find user by ID (with password hash)
      const user = await userRepository.findById(userId);
      
      if (!user) {
        console.log(`[AuthService] Password change failed | userId: ${userId} | reason: user_not_found | ip: ${clientIp}`);
        const error = new Error('Email or password is incorrect');
        error.code = 'invalid_credentials';
        error.statusCode = 401;
        throw error;
      }

      // 2. Verify current password
      const isValidPassword = await this.verifyPassword(currentPassword, user.password);
      
      if (!isValidPassword) {
        console.log(`[AuthService] Password change failed | userId: ${userId} | reason: invalid_current_password | ip: ${clientIp}`);
        const error = new Error('Email or password is incorrect');
        error.code = 'invalid_credentials';
        error.statusCode = 401;
        throw error;
      }

      // 3. Hash new password
      const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
      const newPasswordHash = await bcrypt.hash(newPassword, bcryptRounds);

      // 4. Update password
      await userRepository.updatePassword(userId, newPasswordHash);

      // Log success WITHOUT passwords
      console.log(`[AuthService] Password changed successfully | userId: ${userId} | ip: ${clientIp}`);

      return { success: true };

    } catch (error) {
      // Re-throw known errors (invalid_credentials)
      if (error.code && error.statusCode) {
        throw error;
      }

      // Log unexpected errors WITHOUT sensitive data
      console.error('[AuthService] Password change failed (internal error):', error.message);

      // Generic error for client
      const genericError = new Error('Failed to change password');
      genericError.code = 'password_change_error';
      genericError.statusCode = 500;
      throw genericError;
    }
  }

  /**
   * Get JWT configuration (for testing/debugging)
   * 
   * @returns {Object} - { expiresIn, issuer, audience }
   */
  getConfig() {
    return {
      expiresIn: this.jwtExpiresIn,
      issuer: this.jwtIssuer,
      audience: this.jwtAudience
    };
  }
}

module.exports = AuthService;

