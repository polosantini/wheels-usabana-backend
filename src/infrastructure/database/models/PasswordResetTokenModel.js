/**
 * PasswordResetToken Model
 * 
 * Dedicated collection for password reset tokens with comprehensive tracking.
 * 
 * Design:
 * - Separate from User model for better security and auditability
 * - Tracks IP, User-Agent for security forensics
 * - consumedAt field enables idempotent token consumption
 * - Indexed for fast lookups and automatic cleanup
 * 
 * Security:
 * - tokenHash is SHA-256 of plaintext token (never store plaintext)
 * - expiresAt enables automatic expiration
 * - consumedAt prevents token reuse
 */

const mongoose = require('mongoose');

const passwordResetTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true  // Fast lookups by user
  },
  tokenHash: {
    type: String,
    required: [true, 'Token hash is required'],
    unique: true,  // Prevent duplicate tokens
    index: true    // Fast lookups by token
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiration date is required'],
    index: true  // Enable TTL cleanup and expiry checks
  },
  consumedAt: {
    type: Date,
    default: null  // null = not consumed, Date = consumed timestamp
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true  // Never allow modification
  },
  createdIp: {
    type: String,
    default: null,
    trim: true
  },
  createdUa: {
    type: String,
    default: null,
    trim: true
  }
}, {
  timestamps: false,  // We manage createdAt manually, no updatedAt needed
  strict: true,       // Reject undefined fields
  strictQuery: false
});

// Compound index for efficient token lookup and validation
passwordResetTokenSchema.index({ tokenHash: 1, expiresAt: 1 });

// Index for cleanup queries (find expired, unconsumed tokens)
passwordResetTokenSchema.index({ expiresAt: 1, consumedAt: 1 });

// Index for user-specific queries (invalidate all tokens for user)
passwordResetTokenSchema.index({ userId: 1, consumedAt: 1 });

// TTL index: Automatically delete documents 24 hours after expiration
// This keeps the collection clean without manual cleanup jobs
passwordResetTokenSchema.index(
  { expiresAt: 1 },
  { 
    expireAfterSeconds: 86400,  // 24 hours after expiresAt
    name: 'ttl_expired_tokens'
  }
);

// Virtual: Check if token is expired
passwordResetTokenSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiresAt;
});

// Virtual: Check if token is consumed
passwordResetTokenSchema.virtual('isConsumed').get(function() {
  return this.consumedAt !== null;
});

// Virtual: Check if token is valid (not expired, not consumed)
passwordResetTokenSchema.virtual('isValid').get(function() {
  return !this.isExpired && !this.isConsumed;
});

// Instance method: Mark token as consumed (idempotent)
passwordResetTokenSchema.methods.consume = async function() {
  if (!this.consumedAt) {
    this.consumedAt = new Date();
    await this.save();
  }
  return this;
};

// Static method: Clean up expired tokens manually (if needed)
passwordResetTokenSchema.statics.cleanupExpired = async function() {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  return result.deletedCount;
};

// Static method: Count active tokens for a user
passwordResetTokenSchema.statics.countActiveForUser = async function(userId) {
  return await this.countDocuments({
    userId,
    expiresAt: { $gt: new Date() },
    consumedAt: null
  });
};

const PasswordResetTokenModel = mongoose.model('PasswordResetToken', passwordResetTokenSchema);

module.exports = PasswordResetTokenModel;
