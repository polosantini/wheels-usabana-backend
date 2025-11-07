/**
 * BookingRequest Mongoose Model
 * 
 * Represents a passenger's request to book a seat on a published trip offer.
 * 
 * Business Rules:
 * - A passenger can only have ONE active (pending/accepted) request per trip
 * - Requests start as 'pending' and can transition to other states
 * - Trip must be 'published' and have future departureAt when creating request
 * - Cancellation is idempotent (canceled_by_passenger)
 * 
 * Status Lifecycle (this slice):
 * - pending: Initial state when passenger creates request
 * - canceled_by_passenger: Passenger canceled their request
 * 
 * Future statuses (next story):
 * - accepted: Driver accepted the request (seat allocated)
 * - declined: Driver declined the request
 * - expired: Trip departed without driver action
 */

const mongoose = require('mongoose');

const bookingRequestSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TripOffer',
      required: [true, 'Trip ID is required']
    },
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Passenger ID is required']
    },
    status: {
      type: String,
      enum: {
        values: [
          'pending',
          'accepted',
          'declined',
          'declined_auto', // US-3.4.2: Auto-declined when driver cancels trip
          'declined_by_admin', // Admin manual decline
          'canceled_by_passenger',
          'canceled_by_platform', // US-3.4.2: Canceled when driver cancels trip
          'expired'
        ],
        message: 'Status must be one of: pending, accepted, declined, declined_auto, canceled_by_passenger, canceled_by_platform, expired'
      },
      default: 'pending',
      index: true
    },
    seats: {
      type: Number,
      required: [true, 'Number of seats is required'],
      min: [1, 'Must request at least 1 seat'],
      validate: {
        validator: Number.isInteger,
        message: 'Seats must be an integer'
      },
      default: 1
    },
    note: {
      type: String,
      trim: true,
      maxlength: [300, 'Note cannot exceed 300 characters'],
      default: ''
    },
    // Audit trail fields for driver decisions
    acceptedAt: {
      type: Date,
      default: null
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    declinedAt: {
      type: Date,
      default: null
    },
    declinedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    declineReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Decline reason cannot exceed 500 characters'],
      default: ''
    },
    canceledAt: {
      type: Date,
      default: null
    },
    // Optional cancellation reason for passenger-initiated cancellations (US-3.4.3)
    // Used for audit trail and analytics
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Cancellation reason cannot exceed 500 characters'],
      default: ''
    },
    // Internal flag for refund policy hooks (US-4.2)
    // Set to true when canceled booking is eligible for refund
    // Never exposed in DTOs or API responses
    refundNeeded: {
      type: Boolean,
      default: false,
      select: false // Exclude by default from queries (internal use only)
    },
    // Payment status flag (US-4.1.5)
    // Set to true when payment transaction succeeds
    // Used for read model sync and display purposes
    isPaid: {
      type: Boolean,
      default: false,
      index: true // For filtering paid/unpaid bookings
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: 'booking_requests'
  }
);

// ============================================
// INDEXES
// ============================================

/**
 * Compound index for efficient passenger queries
 * Used by: GET /passengers/bookings (list my requests)
 * Supports sorting by most recent first
 */
bookingRequestSchema.index({ passengerId: 1, createdAt: -1 });

/**
 * Compound index for trip + status queries
 * Used by: Future driver story - viewing requests for their trips
 * Also helps with duplicate detection
 */
bookingRequestSchema.index({ tripId: 1, status: 1 });

/**
 * Compound index for duplicate detection
 * Used by service to check if passenger already has active request for this trip
 * Note: We check for status IN ['pending', 'accepted'] programmatically
 */
bookingRequestSchema.index({ passengerId: 1, tripId: 1, status: 1 });

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Check if this booking request is active (not canceled/declined/expired)
 * Active statuses: pending
 */
bookingRequestSchema.methods.isActive = function () {
  return this.status === 'pending';
};

/**
 * Check if this booking request can be canceled by passenger
 * Only 'pending' requests can be canceled by passenger
 */
bookingRequestSchema.methods.canBeCanceledByPassenger = function () {
  return this.status === 'pending';
};

/**
 * Cancel this booking request (passenger-initiated)
 * Idempotent: if already canceled, no error
 */
bookingRequestSchema.methods.cancelByPassenger = function () {
  if (this.status === 'canceled_by_passenger') {
    // Already canceled, idempotent - no-op
    return this;
  }

  if (!this.canBeCanceledByPassenger()) {
    throw new Error(`Cannot cancel booking with status: ${this.status}`);
  }

  this.status = 'canceled_by_passenger';
  this.canceledAt = new Date();
  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Find active (pending or accepted) booking for a passenger on a specific trip
 * Used to prevent duplicate active bookings
 */
bookingRequestSchema.statics.findActiveBooking = async function (passengerId, tripId) {
  return this.findOne({
    passengerId,
    tripId,
    status: { $in: ['pending', 'accepted'] }
  });
};

/**
 * Count active bookings for a trip (for capacity checking - future use)
 */
bookingRequestSchema.statics.countActiveBookingsForTrip = async function (tripId) {
  return this.countDocuments({
    tripId,
    status: 'pending'
  });
};

/**
 * Find bookings by passenger with filters
 */
bookingRequestSchema.statics.findByPassenger = async function (
  passengerId,
  { status, page = 1, limit = 10 } = {}
) {
  const query = { passengerId };
  if (status) {
    query.status = Array.isArray(status) ? { $in: status } : status;
  }

  const skip = (page - 1) * limit;

  const [bookings, total] = await Promise.all([
    this.find(query)
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .populate('tripId', 'origin destination departureAt estimatedArrivalAt pricePerSeat status')
      .lean(),
    this.countDocuments(query)
  ]);

  return {
    bookings,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
};

// ============================================
// PRE-SAVE HOOKS
// ============================================

/**
 * Pre-save validation and business rules
 */
bookingRequestSchema.pre('save', function (next) {
  // Ensure canceledAt is set when status is canceled_by_passenger
  if (this.status === 'canceled_by_passenger' && !this.canceledAt) {
    this.canceledAt = new Date();
  }

  // Clear canceledAt if status is not a canceled state
  if (!this.status.includes('canceled') && this.canceledAt) {
    this.canceledAt = null;
  }

  next();
});

const BookingRequestModel = mongoose.model('BookingRequest', bookingRequestSchema);

module.exports = BookingRequestModel;

