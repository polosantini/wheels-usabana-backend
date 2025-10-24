/**
 * Password Reset Token Utility
 * 
 * Provides secure token generation and hashing for password reset functionality.
 * 
 * Security principles:
 * - Cryptographically secure random bytes (32 bytes)
 * - URL-safe base64 encoding for tokens
 * - SHA-256 hashing for storage (never store plaintext tokens)
 * - Constant-time comparison for token verification
 */

const crypto = require('crypto');

class ResetTokenUtil {
  /**
   * Generate a cryptographically secure reset token
   * 
   * @returns {string} - URL-safe base64-encoded token (43 characters)
   * 
   * Example: "xB7kN9mQ-pLr2vW8cZ5jT1aH6dF4gY0eU3iO9sA7bK2"
   */
  static generateToken() {
    // Generate 32 bytes of cryptographically secure random data
    const tokenBytes = crypto.randomBytes(32);
    
    // Convert to URL-safe base64 (no +, /, or = characters)
    const token = tokenBytes
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    return token;
  }

  /**
   * Hash a reset token for secure storage
   * 
   * Uses SHA-256 to create a one-way hash of the token.
   * Store the hash in the database, not the plaintext token.
   * 
   * @param {string} token - The plaintext token to hash
   * @returns {string} - Hexadecimal hash (64 characters)
   * 
   * Security: SHA-256 is one-way (cannot reverse to get original token)
   */
  static hashToken(token) {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token: must be a non-empty string');
    }

    return crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
  }

  /**
   * Verify a token against its stored hash
   * 
   * Uses constant-time comparison to prevent timing attacks.
   * 
   * @param {string} plainToken - The token provided by the user
   * @param {string} storedHash - The hash stored in the database
   * @returns {boolean} - true if token matches hash, false otherwise
   */
  static verifyToken(plainToken, storedHash) {
    if (!plainToken || !storedHash) {
      return false;
    }

    try {
      const providedHash = this.hashToken(plainToken);
      
      // Constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(providedHash, 'hex'),
        Buffer.from(storedHash, 'hex')
      );
    } catch (error) {
      // Timing attacks: always take same time even on error
      return false;
    }
  }

  /**
   * Generate token expiry timestamp
   * 
   * @param {number} minutes - Minutes until expiration (default: 15)
   * @returns {Date} - Expiry timestamp
   */
  static getExpiryTime(minutes = 15) {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  /**
   * Check if a token has expired
   * 
   * @param {Date} expiryDate - The expiry timestamp from database
   * @returns {boolean} - true if expired, false otherwise
   */
  static isExpired(expiryDate) {
    if (!expiryDate) {
      return true; // No expiry date means invalid/expired
    }

    return new Date() > new Date(expiryDate);
  }

  /**
   * Check if a token has been consumed
   * 
   * @param {Date|null} consumedAt - The consumption timestamp
   * @returns {boolean} - true if consumed, false otherwise
   */
  static isConsumed(consumedAt) {
    return consumedAt !== null && consumedAt !== undefined;
  }

  /**
   * Generate and hash a reset token (convenience method)
   * 
   * Generates a cryptographically secure token with hash and expiry.
   * This is the primary method for creating password reset tokens.
   * 
   * @param {number} expiryMinutes - Minutes until expiration (default: 15)
   * @returns {Object} - { tokenPlain, tokenHash, expiresAt }
   * 
   * Usage:
   * const { tokenPlain, tokenHash, expiresAt } = ResetTokenUtil.generateResetToken();
   * // Send `tokenPlain` to user via email
   * // Store `tokenHash` and `expiresAt` in database
   * 
   * Returns:
   * - tokenPlain: URL-safe base64 string (43 chars) - send to user
   * - tokenHash: SHA-256 hex string (64 chars) - store in database
   * - expiresAt: Date object - store in database
   */
  static generateResetToken(expiryMinutes = 15) {
    // Generate secure random token (32 bytes)
    const buf = crypto.randomBytes(32);
    
    // Convert to URL-safe base64
    const tokenPlain = buf
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Hash for storage
    const tokenHash = this.hashToken(tokenPlain);
    
    // Calculate expiry
    const expiresAt = this.getExpiryTime(expiryMinutes);

    return {
      tokenPlain,   // Send this to user (via email)
      tokenHash,    // Store this in database
      expiresAt     // Store this in database
    };
  }

  /**
   * DEPRECATED: Use generateResetToken() instead
   * 
   * This method is kept for backward compatibility but may be removed.
   */
  static createResetToken(expiryMinutes = 15) {
    const result = this.generateResetToken(expiryMinutes);
    // Map new names to old names for compatibility
    return {
      token: result.tokenPlain,
      tokenHash: result.tokenHash,
      expiresAt: result.expiresAt
    };
  }
}

module.exports = ResetTokenUtil;
