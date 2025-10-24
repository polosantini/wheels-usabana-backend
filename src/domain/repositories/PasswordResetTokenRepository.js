/**
 * PasswordResetToken Repository Interface
 * 
 * Domain-level abstraction for password reset token operations.
 * This interface defines the contract that infrastructure implementations must follow.
 * 
 * Separation of concerns:
 * - Domain layer defines WHAT operations are needed
 * - Infrastructure layer defines HOW they are implemented
 */

class PasswordResetTokenRepository {
  /**
   * Create a new password reset token
   * 
   * @param {Object} tokenData - Token data
   * @param {string} tokenData.userId - User ID
   * @param {string} tokenData.tokenHash - SHA-256 hash
   * @param {Date} tokenData.expiresAt - Expiry timestamp
   * @param {string} [tokenData.createdIp] - IP address
   * @param {string} [tokenData.createdUa] - User-Agent
   * @returns {Promise<Object>} - Created token
   */
  async create(tokenData) {
    throw new Error('Method not implemented');
  }

  /**
   * Find token by hash
   * 
   * @param {string} tokenHash - SHA-256 hash
   * @returns {Promise<Object|null>} - Token or null
   */
  async findByHash(tokenHash) {
    throw new Error('Method not implemented');
  }

  /**
   * Find valid (unexpired, unconsumed) token
   * 
   * @param {string} tokenHash - SHA-256 hash
   * @returns {Promise<Object|null>} - Valid token or null
   */
  async findValidToken(tokenHash) {
    throw new Error('Method not implemented');
  }

  /**
   * Mark token as consumed (idempotent)
   * 
   * @param {string} tokenHash - Token hash
   * @returns {Promise<Object|null>} - Updated token or null
   */
  async consumeToken(tokenHash) {
    throw new Error('Method not implemented');
  }

  /**
   * Invalidate all active tokens for user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<number>} - Count of invalidated tokens
   */
  async invalidateActiveTokens(userId) {
    throw new Error('Method not implemented');
  }

  /**
   * Count active tokens for user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<number>} - Token count
   */
  async countActiveForUser(userId) {
    throw new Error('Method not implemented');
  }

  /**
   * Clean up expired tokens
   * 
   * @returns {Promise<number>} - Count deleted
   */
  async cleanupExpired() {
    throw new Error('Method not implemented');
  }

  /**
   * Get all tokens for user (audit/debug)
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Array>} - Token documents
   */
  async findByUserId(userId) {
    throw new Error('Method not implemented');
  }
}

module.exports = PasswordResetTokenRepository;
