/**
 * PasswordResetToken Repository (MongoDB Implementation)
 * 
 * Data access layer for password reset token operations.
 * Implements the domain repository interface using MongoDB/Mongoose.
 * 
 * Responsibilities:
 * - Create tokens with metadata (IP, User-Agent)
 * - Find tokens by hash
 * - Consume tokens (mark as used)
 * - Invalidate all active tokens for a user
 * - Cleanup expired tokens
 * 
 * Security:
 * - Never exposes plaintext tokens
 * - Idempotent consumption (can mark consumed multiple times safely)
 * - Atomic operations to prevent race conditions
 */

const PasswordResetTokenModel = require('../database/models/PasswordResetTokenModel');
const DomainPasswordResetTokenRepository = require('../../domain/repositories/PasswordResetTokenRepository');

class MongoPasswordResetTokenRepository extends DomainPasswordResetTokenRepository {
  /**
   * Create a new password reset token
   * 
   * @param {Object} tokenData - Token creation data
   * @param {string} tokenData.userId - MongoDB ObjectId of user
   * @param {string} tokenData.tokenHash - SHA-256 hash of token
   * @param {Date} tokenData.expiresAt - Token expiration timestamp
   * @param {string} [tokenData.createdIp] - IP address of requester
   * @param {string} [tokenData.createdUa] - User-Agent header
   * @returns {Promise<Object>} - Created token document
   * 
   * @throws {Error} - If database operation fails
   */
  async create(tokenData) {
    try {
      const token = new PasswordResetTokenModel({
        userId: tokenData.userId,
        tokenHash: tokenData.tokenHash,
        expiresAt: tokenData.expiresAt,
        createdIp: tokenData.createdIp || null,
        createdUa: tokenData.createdUa || null
      });

      await token.save();
      return token;
    } catch (error) {
      console.error('[PasswordResetTokenRepository] Create failed:', error.message);
      throw error;
    }
  }

  /**
   * Find a token by its hash
   * 
   * @param {string} tokenHash - SHA-256 hash to lookup
   * @returns {Promise<Object|null>} - Token document or null if not found
   * 
   * Security: Does not filter by expiry/consumption - caller must validate
   */
  async findByHash(tokenHash) {
    try {
      const token = await PasswordResetTokenModel.findOne({ tokenHash }).lean();
      return token;
    } catch (error) {
      console.error('[PasswordResetTokenRepository] FindByHash failed:', error.message);
      throw error;
    }
  }

  /**
   * Find a valid (unexpired, unconsumed) token by hash
   * 
   * @param {string} tokenHash - SHA-256 hash to lookup
   * @returns {Promise<Object|null>} - Valid token document or null
   * 
   * This is a convenience method that combines lookup with validation.
   */
  async findValidToken(tokenHash) {
    try {
      const token = await PasswordResetTokenModel.findOne({
        tokenHash,
        expiresAt: { $gt: new Date() },  // Not expired
        consumedAt: null                  // Not consumed
      }).lean();

      return token;
    } catch (error) {
      console.error('[PasswordResetTokenRepository] FindValidToken failed:', error.message);
      throw error;
    }
  }

  /**
   * Mark a token as consumed (idempotent)
   * 
   * Uses atomic update to prevent race conditions.
   * Safe to call multiple times - only sets consumedAt once.
   * 
   * @param {string} tokenHash - Hash of token to consume
   * @returns {Promise<Object|null>} - Updated token document or null if not found
   */
  async consumeToken(tokenHash) {
    try {
      const token = await PasswordResetTokenModel.findOneAndUpdate(
        { 
          tokenHash,
          consumedAt: null  // Only update if not already consumed
        },
        { 
          $set: { consumedAt: new Date() }
        },
        { 
          new: true,  // Return updated document
          runValidators: false  // Skip validators (we're only setting consumedAt)
        }
      );

      return token;
    } catch (error) {
      console.error('[PasswordResetTokenRepository] ConsumeToken failed:', error.message);
      throw error;
    }
  }

  /**
   * Invalidate all active tokens for a user
   * 
   * Marks all unexpired, unconsumed tokens as consumed.
   * Useful when:
   * - User successfully resets password (invalidate other pending tokens)
   * - User requests new token (invalidate old ones)
   * - Security event (force invalidation)
   * 
   * @param {string} userId - MongoDB ObjectId of user
   * @returns {Promise<number>} - Count of invalidated tokens
   */
  async invalidateActiveTokens(userId) {
    try {
      const result = await PasswordResetTokenModel.updateMany(
        {
          userId,
          expiresAt: { $gt: new Date() },  // Only active tokens
          consumedAt: null                  // Not already consumed
        },
        {
          $set: { consumedAt: new Date() }
        }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error('[PasswordResetTokenRepository] InvalidateActiveTokens failed:', error.message);
      throw error;
    }
  }

  /**
   * Count active tokens for a user
   * 
   * @param {string} userId - MongoDB ObjectId of user
   * @returns {Promise<number>} - Count of active tokens
   */
  async countActiveForUser(userId) {
    try {
      return await PasswordResetTokenModel.countDocuments({
        userId,
        expiresAt: { $gt: new Date() },
        consumedAt: null
      });
    } catch (error) {
      console.error('[PasswordResetTokenRepository] CountActiveForUser failed:', error.message);
      throw error;
    }
  }

  /**
   * Delete expired tokens (manual cleanup)
   * 
   * Note: MongoDB TTL index handles this automatically after 24 hours.
   * This method is for manual/immediate cleanup if needed.
   * 
   * @returns {Promise<number>} - Count of deleted tokens
   */
  async cleanupExpired() {
    try {
      const result = await PasswordResetTokenModel.deleteMany({
        expiresAt: { $lt: new Date() }
      });

      return result.deletedCount;
    } catch (error) {
      console.error('[PasswordResetTokenRepository] CleanupExpired failed:', error.message);
      throw error;
    }
  }

  /**
   * Get all tokens for a user (for debugging/auditing)
   * 
   * @param {string} userId - MongoDB ObjectId of user
   * @returns {Promise<Array>} - Array of token documents
   */
  async findByUserId(userId) {
    try {
      return await PasswordResetTokenModel.find({ userId })
        .sort({ createdAt: -1 })
        .lean();
    } catch (error) {
      console.error('[PasswordResetTokenRepository] FindByUserId failed:', error.message);
      throw error;
    }
  }
}

module.exports = MongoPasswordResetTokenRepository;
