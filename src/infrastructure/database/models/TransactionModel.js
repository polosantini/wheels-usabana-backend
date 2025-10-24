/**
 * Transaction Model (US-4.1.1)
 * 
 * Mongoose schema for payment transactions.
 * 
 * Constraints:
 * - Unique providerPaymentIntentId (prevents duplicate intents)
 * - Compound index on (bookingId, status) for quick duplicate checks
 * - Immutable amount/currency snapshots
 * 
 * Indexes:
 * - bookingId + status (for duplicate payment checks)
 * - passengerId (for passenger's transaction history)
 * - driverId (for driver's earnings reports)
 * - providerPaymentIntentId (for webhook lookups)
 */

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Associations (denormalized for performance)
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BookingRequest',
    required: true,
    index: true
  },
  tripId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TripOffer',
    required: true,
    index: true
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  passengerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Payment details (immutable snapshots)
  amount: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'amount must be an integer (smallest currency unit)'
    }
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    enum: ['COP', 'USD', 'EUR'],
    default: 'COP'
  },

  // Provider details
  provider: {
    type: String,
    required: true,
    enum: ['stripe'],
    default: 'stripe'
  },
  providerPaymentIntentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  providerClientSecret: {
    type: String,
    required: true,
    select: false // Sensitive: don't return by default
  },

  // Status tracking
  status: {
    type: String,
    required: true,
    enum: [
      'requires_payment_method',
      'processing',
      'succeeded',
      'failed',
      'canceled',
      'refunded'
    ],
    default: 'requires_payment_method',
    index: true
  },

  // Error details (for failed transactions)
  errorCode: {
    type: String,
    default: null
  },
  errorMessage: {
    type: String,
    default: null
  },

  // Metadata (provider response, snapshot details)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  processedAt: {
    type: Date,
    default: null,
    index: true
  }
}, {
  timestamps: false, // Custom timestamp handling
  collection: 'transactions'
});

// Compound indexes for performance
transactionSchema.index({ bookingId: 1, status: 1 }); // Duplicate payment checks
transactionSchema.index({ status: 1, createdAt: -1 }); // Admin queries
transactionSchema.index({ passengerId: 1, createdAt: -1 }); // Passenger history
transactionSchema.index({ driverId: 1, status: 1, createdAt: -1 }); // Driver earnings

// Virtual for checking if terminal
transactionSchema.virtual('isTerminal').get(function() {
  return ['succeeded', 'failed', 'canceled', 'refunded'].includes(this.status);
});

// Virtual for checking if active
transactionSchema.virtual('isActive').get(function() {
  return ['requires_payment_method', 'processing'].includes(this.status);
});

// Pre-save validation
transactionSchema.pre('save', function(next) {
  // Ensure processedAt is set for terminal states
  if (this.isTerminal && !this.processedAt) {
    this.processedAt = new Date();
  }

  // Validate amount is positive
  if (this.amount <= 0) {
    return next(new Error('Transaction amount must be positive'));
  }

  next();
});

// Instance method: Convert to domain entity
transactionSchema.methods.toEntity = function() {
  const Transaction = require('../../domain/entities/Transaction');
  return new Transaction({
    id: this._id.toString(),
    bookingId: this.bookingId.toString(),
    tripId: this.tripId.toString(),
    driverId: this.driverId.toString(),
    passengerId: this.passengerId.toString(),
    amount: this.amount,
    currency: this.currency,
    provider: this.provider,
    providerPaymentIntentId: this.providerPaymentIntentId,
    providerClientSecret: this.providerClientSecret,
    status: this.status,
    errorCode: this.errorCode,
    errorMessage: this.errorMessage,
    metadata: this.metadata,
    createdAt: this.createdAt,
    processedAt: this.processedAt
  });
};

// Static method: Create from domain entity
transactionSchema.statics.fromEntity = function(entity) {
  return new this({
    _id: entity.id ? new mongoose.Types.ObjectId(entity.id) : undefined,
    bookingId: new mongoose.Types.ObjectId(entity.bookingId),
    tripId: new mongoose.Types.ObjectId(entity.tripId),
    driverId: new mongoose.Types.ObjectId(entity.driverId),
    passengerId: new mongoose.Types.ObjectId(entity.passengerId),
    amount: entity.amount,
    currency: entity.currency,
    provider: entity.provider,
    providerPaymentIntentId: entity.providerPaymentIntentId,
    providerClientSecret: entity.providerClientSecret,
    status: entity.status,
    errorCode: entity.errorCode,
    errorMessage: entity.errorMessage,
    metadata: entity.metadata,
    createdAt: entity.createdAt,
    processedAt: entity.processedAt
  });
};

const TransactionModel = mongoose.model('Transaction', transactionSchema);

module.exports = TransactionModel;
