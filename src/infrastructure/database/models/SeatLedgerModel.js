/**
 * SeatLedger Mongoose Model
 * 
 * Tracks allocated seats per trip to enforce capacity constraints.
 * Prevents overbooking through atomic operations.
 * 
 * Business Rules:
 * - One ledger entry per trip (unique tripId)
 * - allocatedSeats must never exceed trip's totalSeats
 * - All updates must be atomic (using findOneAndUpdate with conditions)
 * - Created on first accept, updated on subsequent accepts
 * 
 * Race Safety:
 * - Uses MongoDB's findOneAndUpdate with conditional guards
 * - Ensures exactly one success when multiple concurrent accepts compete for last seat
 */

const mongoose = require('mongoose');

const seatLedgerSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TripOffer',
      required: [true, 'Trip ID is required'],
      unique: true
    },
    allocatedSeats: {
      type: Number,
      required: [true, 'Allocated seats is required'],
      min: [0, 'Allocated seats cannot be negative'],
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Allocated seats must be an integer'
      }
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: 'seat_ledgers'
  }
);

// ============================================
// INDEXES
// ============================================

/**
 * Unique index on tripId ensures one ledger per trip
 * Critical for preventing duplicate ledger entries
 * NOTE: Index is already created by the "unique: true" in schema definition above
 * No need for explicit schema.index() call to avoid duplicate index warning
 */

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Check if there's capacity to allocate more seats
 * @param {number} totalSeats - Total seats available on the trip
 * @param {number} requestedSeats - Number of seats to allocate
 * @returns {boolean} True if allocation is possible
 */
seatLedgerSchema.methods.hasCapacity = function (totalSeats, requestedSeats = 1) {
  return this.allocatedSeats + requestedSeats <= totalSeats;
};

/**
 * Get remaining available seats
 * @param {number} totalSeats - Total seats available on the trip
 * @returns {number} Number of remaining seats
 */
seatLedgerSchema.methods.getRemainingSeats = function (totalSeats) {
  return Math.max(0, totalSeats - this.allocatedSeats);
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Atomically increment allocated seats for a trip
 * Race-safe: uses findOneAndUpdate with conditional guards
 * 
 * @param {string} tripId - Trip ObjectId
 * @param {number} totalSeats - Total seats available on trip
 * @param {number} seatsToAllocate - Number of seats to allocate (default 1)
 * @returns {Promise<Document|null>} Updated ledger or null if capacity exceeded
 */
seatLedgerSchema.statics.allocateSeats = async function (
  tripId,
  totalSeats,
  seatsToAllocate = 1
) {
  // Step 1: Try to find existing ledger
  let ledger = await this.findOne({ tripId });

  if (!ledger) {
    // No ledger exists - create one if we have capacity
    if (seatsToAllocate <= totalSeats) {
      try {
        ledger = await this.create({
          tripId,
          allocatedSeats: seatsToAllocate
        });
        return ledger;
      } catch (error) {
        // If duplicate key error (race condition), retry the update
        if (error.code === 11000) {
          ledger = await this.findOne({ tripId });
          // Fall through to the update logic below
        } else {
          throw error;
        }
      }
    } else {
      // Requested seats exceed total capacity
      return null;
    }
  }

  // Step 2: Ledger exists - atomic increment with capacity guard
  const updatedLedger = await this.findOneAndUpdate(
    {
      tripId,
      allocatedSeats: { $lte: totalSeats - seatsToAllocate } // Guard: ensure capacity
    },
    {
      $inc: { allocatedSeats: seatsToAllocate }
    },
    {
      new: true, // Return updated document
      runValidators: true
    }
  );

  // If updatedLedger is null, it means capacity guard failed
  return updatedLedger;
};

/**
 * Get current ledger for a trip (create if doesn't exist)
 * @param {string} tripId - Trip ObjectId
 * @returns {Promise<Document>} Ledger document
 */
seatLedgerSchema.statics.getOrCreateLedger = async function (tripId) {
  const ledger = await this.findOneAndUpdate(
    { tripId },
    { $setOnInsert: { allocatedSeats: 0 } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  return ledger;
};

/**
 * Get ledger for a trip (returns null if doesn't exist)
 * @param {string} tripId - Trip ObjectId
 * @returns {Promise<Document|null>} Ledger document or null
 */
seatLedgerSchema.statics.getLedgerByTripId = async function (tripId) {
  return this.findOne({ tripId });
};

const SeatLedgerModel = mongoose.model('SeatLedger', seatLedgerSchema);

module.exports = SeatLedgerModel;

