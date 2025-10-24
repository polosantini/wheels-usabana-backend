/**
 * MongoBookingRequestRepository
 * 
 * MongoDB implementation of BookingRequestRepository.
 * Handles persistence and queries for booking requests.
 */

const BookingRequestModel = require('../database/models/BookingRequestModel');
const BookingRequest = require('../../domain/entities/BookingRequest');

class MongoBookingRequestRepository {
  /**
   * Convert Mongoose document to domain entity
   * @private
   */
  _toDomain(doc) {
    if (!doc) return null;

    const obj = doc.toObject ? doc.toObject() : doc;

    return new BookingRequest({
      id: obj._id.toString(),
      tripId: obj.tripId.toString(),
      passengerId: obj.passengerId.toString(),
      status: obj.status,
      seats: obj.seats,
      note: obj.note || '',
      acceptedAt: obj.acceptedAt,
      acceptedBy: obj.acceptedBy ? obj.acceptedBy.toString() : null,
      declinedAt: obj.declinedAt,
      declinedBy: obj.declinedBy ? obj.declinedBy.toString() : null,
      canceledAt: obj.canceledAt,
      isPaid: obj.isPaid || false, // US-4.1.5: Payment status
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt
    });
  }

  /**
   * Convert array of Mongoose documents to domain entities
   * @private
   */
  _toDomainArray(docs) {
    return docs.map((doc) => this._toDomain(doc));
  }

  /**
   * Create a new booking request
   * @param {Object} data - Booking request data
   * @returns {Promise<BookingRequest>} Created booking request
   */
  async create({ tripId, passengerId, seats, note }) {
    const doc = await BookingRequestModel.create({
      tripId,
      passengerId,
      seats,
      note,
      status: 'pending'
    });

    return this._toDomain(doc);
  }

  /**
   * Find booking request by ID
   * @param {string} id - Booking request ID
   * @returns {Promise<BookingRequest|null>}
   */
  async findById(id) {
    const doc = await BookingRequestModel.findById(id);
    return this._toDomain(doc);
  }

  /**
   * Find active booking for a passenger on a specific trip
   * Used to prevent duplicate active bookings
   * @param {string} passengerId - Passenger ID
   * @param {string} tripId - Trip ID
   * @returns {Promise<BookingRequest|null>}
   */
  async findActiveBooking(passengerId, tripId) {
    const doc = await BookingRequestModel.findOne({
      passengerId,
      tripId,
      status: { $in: ['pending', 'accepted'] }
    });

    return this._toDomain(doc);
  }

  /**
   * Find all booking requests by passenger
   * @param {string} passengerId - Passenger ID
   * @param {Object} filters - Optional filters
   * @param {string|string[]} filters.status - Status filter (single or array)
   * @param {Date} filters.fromDate - Minimum createdAt date
   * @param {Date} filters.toDate - Maximum createdAt date
   * @param {number} filters.page - Page number (default: 1)
   * @param {number} filters.limit - Results per page (default: 10)
   * @returns {Promise<Object>} Paginated results with bookings, total, page, limit, totalPages
   */
  async findByPassenger(passengerId, { status, fromDate, toDate, page = 1, limit = 10 } = {}) {
    const query = { passengerId };

    if (status) {
      query.status = Array.isArray(status) ? { $in: status } : status;
    }

    // Date range filters
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        query.createdAt.$gte = fromDate;
      }
      if (toDate) {
        query.createdAt.$lte = toDate;
      }
    }

    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      BookingRequestModel.find(query)
        .sort({ createdAt: -1 }) // Most recent first
        .skip(skip)
        .limit(limit)
        .lean(),
      BookingRequestModel.countDocuments(query)
    ]);

    return {
      bookings: this._toDomainArray(docs),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Find booking requests with populated trip data (for API responses)
   * @param {string} passengerId - Passenger ID
   * @param {Object} filters - Optional filters
   * @returns {Promise<Object>} Paginated results with Mongoose documents (with populated tripId)
   */
  async findByPassengerWithTrip(passengerId, { status, page = 1, limit = 10 } = {}) {
    const query = { passengerId };

    if (status) {
      query.status = Array.isArray(status) ? { $in: status } : status;
    }

    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      BookingRequestModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('tripId', 'origin destination departureAt estimatedArrivalAt pricePerSeat status driverId')
        .populate({
          path: 'tripId',
          populate: {
            path: 'driverId',
            select: 'firstName lastName corporateEmail'
          }
        })
        .populate('passengerId', 'firstName lastName corporateEmail')
        .lean(),
      BookingRequestModel.countDocuments(query)
    ]);

    return {
      bookings: docs, // Return Mongoose docs with populated tripId
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Update booking request status to canceled_by_passenger
   * Used for pending bookings that don't require seat deallocation
   * @param {string} id - Booking request ID
   * @param {string} reason - Optional cancellation reason for audit trail
   * @returns {Promise<BookingRequest>} Updated booking request
   */
  async cancel(id, reason = '') {
    const doc = await BookingRequestModel.findByIdAndUpdate(
      id,
      {
        status: 'canceled_by_passenger',
        canceledAt: new Date(),
        cancellationReason: reason
      },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return null;
    }

    return this._toDomain(doc);
  }

  /**
   * Cancel accepted booking request with atomic seat deallocation
   * Uses MongoDB transaction to ensure:
   * 1. Booking status updated to canceled_by_passenger
   * 2. Seats deallocated from SeatLedger atomically
   * 3. refundNeeded flag persisted (for US-4.2)
   * 4. cancellationReason stored for audit trail
   * 
   * @param {BookingRequest} bookingEntity - Booking entity with updated state (from entity.cancelByPassenger)
   * @param {MongoSeatLedgerRepository} seatLedgerRepository - Injected for seat deallocation
   * @returns {Promise<BookingRequest>} Updated booking request
   * @throws {Error} if transaction fails or seat deallocation would go negative
   */
  async cancelWithTransaction(bookingEntity, seatLedgerRepository) {
    const session = await BookingRequestModel.startSession();

    try {
      let updatedBooking = null;

      await session.withTransaction(async () => {
        // 1. Update booking status, set refundNeeded flag, and store cancellation reason
        const doc = await BookingRequestModel.findByIdAndUpdate(
          bookingEntity.id,
          {
            status: 'canceled_by_passenger',
            canceledAt: new Date(),
            cancellationReason: bookingEntity.cancellationReason || '',
            refundNeeded: bookingEntity.refundNeeded // Internal flag for US-4.2
          },
          { new: true, runValidators: true, session }
        );

        if (!doc) {
          throw new Error(`Booking request not found: ${bookingEntity.id}`);
        }

        // 2. Atomically deallocate seats from ledger
        const ledgerUpdated = await seatLedgerRepository.deallocateSeats(
          bookingEntity.tripId,
          bookingEntity.seats
        );

        if (!ledgerUpdated) {
          throw new Error(
            `Failed to deallocate seats atomically. Ledger may not exist or would go negative. tripId: ${bookingEntity.tripId}, seats: ${bookingEntity.seats}`
          );
        }

        updatedBooking = doc;
      });

      return updatedBooking ? this._toDomain(updatedBooking) : null;
    } catch (error) {
      console.error(
        `[MongoBookingRequestRepository] Transaction failed during cancellation | bookingId: ${bookingEntity.id} | tripId: ${bookingEntity.tripId} | error: ${error.message}`
      );
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Count active bookings for a trip
   * Used for capacity checking (future use)
   * @param {string} tripId - Trip ID
   * @returns {Promise<number>} Count of active bookings
   */
  async countActiveBookingsForTrip(tripId) {
    return BookingRequestModel.countDocuments({
      tripId,
      status: 'pending'
    });
  }

  /**
   * Find booking requests by trip (driver view)
   * @param {string} tripId - Trip ID
   * @param {Object} filters - Optional filters
   * @param {string|string[]} filters.status - Status filter (single or array)
   * @param {number} filters.page - Page number (default: 1)
   * @param {number} filters.limit - Results per page (default: 10, max: 50)
   * @returns {Promise<Object>} Paginated results with bookings, total, page, limit, totalPages
   */
  async findByTrip(tripId, { status, page = 1, limit = 10 } = {}) {
    const query = { tripId };

    if (status) {
      query.status = Array.isArray(status) ? { $in: status } : status;
    }

    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      BookingRequestModel.find(query)
        .sort({ createdAt: -1 }) // Most recent first
        .skip(skip)
        .limit(limit)
        .lean(),
      BookingRequestModel.countDocuments(query)
    ]);

    return {
      bookings: this._toDomainArray(docs),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Update booking request status to accepted (driver decision)
   * @param {string} id - Booking request ID
   * @param {string} driverId - Accepting driver ID
   * @returns {Promise<BookingRequest>} Updated booking request
   */
  async accept(id, driverId) {
    const doc = await BookingRequestModel.findByIdAndUpdate(
      id,
      {
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedBy: driverId
      },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return null;
    }

    return this._toDomain(doc);
  }

  /**
   * Update booking request status to declined (driver decision)
   * @param {string} id - Booking request ID
   * @param {string} driverId - Declining driver ID
   * @returns {Promise<BookingRequest>} Updated booking request
   */
  async decline(id, driverId, reason = null) {
    const updateData = {
      status: 'declined',
      declinedAt: new Date(),
      declinedBy: driverId
    };

    if (reason) {
      updateData.declineReason = reason;
    }

    const doc = await BookingRequestModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!doc) {
      return null;
    }

    return this._toDomain(doc);
  }

  /**
   * Find all pending bookings for a trip (no pagination)
   * Used for cascade operations when driver cancels trip
   * @param {string} tripId - Trip ID
   * @returns {Promise<BookingRequest[]>} Array of pending bookings
   */
  async findAllPendingByTrip(tripId) {
    const docs = await BookingRequestModel.find({
      tripId,
      status: 'pending'
    }).lean();

    return this._toDomainArray(docs);
  }

  /**
   * Find all accepted bookings for a trip (no pagination)
   * Used for cascade operations when driver cancels trip
   * @param {string} tripId - Trip ID
   * @returns {Promise<BookingRequest[]>} Array of accepted bookings
   */
  async findAllAcceptedByTrip(tripId) {
    const docs = await BookingRequestModel.find({
      tripId,
      status: 'accepted'
    }).lean();

    return this._toDomainArray(docs);
  }

  /**
   * Bulk update pending bookings to declined_auto
   * Used when driver cancels trip (cascade operation)
   * Returns count of updated documents
   * 
   * @param {string} tripId - Trip ID
   * @param {ClientSession} session - MongoDB session for transaction
   * @returns {Promise<number>} Count of updated bookings
   */
  async bulkDeclineAuto(tripId, session = null) {
    const result = await BookingRequestModel.updateMany(
      {
        tripId,
        status: 'pending'
      },
      {
        $set: {
          status: 'declined_auto',
          declinedAt: new Date(),
          declinedBy: 'system',
          updatedAt: new Date()
        }
      },
      { session }
    );

    return result.modifiedCount;
  }

  /**
   * Bulk update accepted bookings to canceled_by_platform
   * Used when driver cancels trip (cascade operation)
   * Returns count of updated documents
   * 
   * @param {string} tripId - Trip ID
   * @param {ClientSession} session - MongoDB session for transaction
   * @returns {Promise<number>} Count of updated bookings
   */
  async bulkCancelByPlatform(tripId, session = null) {
    const result = await BookingRequestModel.updateMany(
      {
        tripId,
        status: 'accepted'
      },
      {
        $set: {
          status: 'canceled_by_platform',
          canceledAt: new Date(),
          refundNeeded: true, // Platform cancellations always trigger refunds
          updatedAt: new Date()
        }
      },
      { session }
    );

    return result.modifiedCount;
  }

  /**
   * Bulk expire old pending bookings (US-3.4.4)
   * Marks pending bookings as expired when createdAt is older than cutoff time
   * Idempotent: Only updates bookings with status='pending'
   * 
   * @param {Date} cutoffTime - Bookings created before this time will be expired
   * @returns {Promise<number>} Count of expired bookings
   */
  async bulkExpireOldPendings(cutoffTime) {
    const result = await BookingRequestModel.updateMany(
      {
        status: 'pending',
        createdAt: { $lt: cutoffTime }
      },
      {
        $set: {
          status: 'expired',
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount;
  }

  /**
   * Mark booking as paid (US-4.1.5)
   * Updates isPaid flag when payment transaction succeeds
   * Idempotent: Safe to call multiple times
   * 
   * @param {string} bookingId - Booking request ID
   * @returns {Promise<BookingRequest|null>} Updated booking or null if not found
   */
  async markAsPaid(bookingId) {
    const doc = await BookingRequestModel.findByIdAndUpdate(
      bookingId,
      {
        $set: {
          isPaid: true,
          updatedAt: new Date()
        }
      },
      { new: true, runValidators: true }
    );

    return this._toDomain(doc);
  }

  /**
   * Delete booking request (for testing only)
   * @param {string} id - Booking request ID
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(id) {
    const result = await BookingRequestModel.findByIdAndDelete(id);
    return !!result;
  }
}

module.exports = MongoBookingRequestRepository;

