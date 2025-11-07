const TripOfferRepository = require('../../domain/repositories/TripOfferRepository');
const TripOfferModel = require('../database/models/TripOfferModel');
const TripOffer = require('../../domain/entities/TripOffer');

/**
 * MongoDB implementation of TripOfferRepository
 */
class MongoTripOfferRepository extends TripOfferRepository {
  /**
   * Map Mongoose document to domain entity
   * @private
   */
  _toDomain(doc) {
    if (!doc) return null;

    // Helper to safely convert ObjectId to string (handles both Mongoose docs and lean objects)
    const toStr = (val) => val ? val.toString() : val;

    return new TripOffer({
      id: toStr(doc._id),
      driverId: toStr(doc.driverId),
      vehicleId: toStr(doc.vehicleId),
      origin: doc.origin,
      destination: doc.destination,
      departureAt: doc.departureAt,
      estimatedArrivalAt: doc.estimatedArrivalAt,
      pricePerSeat: doc.pricePerSeat,
      totalSeats: doc.totalSeats,
      status: doc.status,
      notes: doc.notes,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  }

  /**
   * Map array of Mongoose documents to domain entities
   * @private
   */
  _toDomainArray(docs) {
    return docs.map((doc) => this._toDomain(doc));
  }

  async create(tripData) {
    const doc = await TripOfferModel.create(tripData);
    return this._toDomain(doc);
  }

  async findById(tripId) {
    const doc = await TripOfferModel.findById(tripId);
    return this._toDomain(doc);
  }

  async findByDriverId(driverId, filters = {}) {
    const query = { driverId };

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.fromDate) {
      query.departureAt = { $gte: new Date(filters.fromDate) };
    }

    if (filters.toDate) {
      query.departureAt = query.departureAt || {};
      query.departureAt.$lte = new Date(filters.toDate);
    }

    const docs = await TripOfferModel.find(query).sort({ departureAt: 1 });
    return this._toDomainArray(docs);
  }

  async findOverlappingTrips(driverId, departureAt, estimatedArrivalAt, excludeTripId = null) {
    const docs = await TripOfferModel.findOverlappingTrips(
      driverId,
      departureAt,
      estimatedArrivalAt,
      excludeTripId
    );
    return this._toDomainArray(docs);
  }

  async update(tripId, updates) {
    const doc = await TripOfferModel.findByIdAndUpdate(
      tripId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!doc) {
      throw new Error('Trip offer not found');
    }

    return this._toDomain(doc);
  }

  async cancel(tripId) {
    const doc = await TripOfferModel.findByIdAndUpdate(
      tripId,
      { $set: { status: 'canceled' } },
      { new: true }
    );

    if (!doc) {
      throw new Error('Trip offer not found');
    }

    return this._toDomain(doc);
  }

  async findUpcomingByDriver(driverId) {
    const docs = await TripOfferModel.findUpcomingByDriver(driverId);
    return this._toDomainArray(docs);
  }

  async countByDriverAndStatus(driverId, status) {
    return TripOfferModel.countDocuments({ driverId, status });
  }

  /**
   * Search published trips with filters (for passengers)
   * Only returns: status='published' AND departureAt > now
   * 
   * @param {Object} filters - Search filters
   * @param {string} filters.qOrigin - Origin text search (case-insensitive)
   * @param {string} filters.qDestination - Destination text search (case-insensitive)
   * @param {Date} filters.fromDate - Minimum departure date
   * @param {Date} filters.toDate - Maximum departure date
   * @param {string} filters.fromTime - Minimum departure time (HH:MM format)
   * @param {string} filters.toTime - Maximum departure time (HH:MM format)
   * @param {number} filters.minAvailableSeats - Minimum available seats required
   * @param {number} filters.minPrice - Minimum price per seat
   * @param {number} filters.maxPrice - Maximum price per seat
   * @param {number} filters.page - Page number (default: 1)
   * @param {number} filters.pageSize - Results per page (default: 10, max: 50)
   * @returns {Promise<Object>} { trips, total, page, pageSize, totalPages }
   */
  async searchPublishedTrips(filters = {}) {
    const {
      qOrigin,
      qDestination,
      fromDate,
      toDate,
      fromTime,
      toTime,
      minAvailableSeats,
      minPrice,
      maxPrice,
      page = 1,
      pageSize = 10
    } = filters;

    // Build query
    const query = {
      status: 'published',
      departureAt: { $gt: new Date() } // Only future trips
    };

    // Text search for origin (case-insensitive, safe regex)
    if (qOrigin) {
      // Escape special regex characters
      const escapedOrigin = qOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query['origin.text'] = { $regex: escapedOrigin, $options: 'i' };
    }

    // Text search for destination (case-insensitive, safe regex)
    if (qDestination) {
      // Escape special regex characters
      const escapedDestination = qDestination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query['destination.text'] = { $regex: escapedDestination, $options: 'i' };
    }

    // Date range filters
    if (fromDate) {
      query.departureAt.$gte = new Date(fromDate);
    }

    if (toDate) {
      query.departureAt.$lte = new Date(toDate);
    }

    // Time range filters (applied to departureAt hour)
    if (fromTime || toTime) {
      // We'll filter by time after fetching, or use aggregation
      // For now, we'll apply time filters in memory after getting results
      // This is simpler but less efficient for large datasets
    }

    // Price filters
    if (minPrice !== undefined) {
      query.pricePerSeat = query.pricePerSeat || {};
      query.pricePerSeat.$gte = minPrice;
    }

    if (maxPrice !== undefined) {
      query.pricePerSeat = query.pricePerSeat || {};
      query.pricePerSeat.$lte = maxPrice;
    }

    // Pagination
    const skip = (page - 1) * pageSize;
    const limit = Math.min(pageSize, 50); // Max 50 results per page

    // Execute query
    let docs = await TripOfferModel.find(query)
      .sort({ departureAt: 1 }) // Sort by departure ascending (soonest first)
      .skip(skip)
      .limit(limit * 2) // Fetch more to account for filtering
      .lean();

    // Apply time filters if specified
    if (fromTime || toTime) {
      docs = docs.filter(doc => {
        const departure = new Date(doc.departureAt);
        const hour = departure.getHours();
        const minute = departure.getMinutes();
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        
        if (fromTime && timeStr < fromTime) return false;
        if (toTime && timeStr > toTime) return false;
        return true;
      });
    }

    // Filter by available seats if specified
    if (minAvailableSeats !== undefined) {
      const SeatLedgerModel = require('../database/models/SeatLedgerModel');
      const tripIds = docs.map(doc => doc._id);
      const ledgers = await SeatLedgerModel.find({ tripId: { $in: tripIds } }).lean();
      const ledgerMap = new Map(ledgers.map(l => [l.tripId.toString(), l.allocatedSeats]));

      docs = docs.filter(doc => {
        const allocatedSeats = ledgerMap.get(doc._id.toString()) || 0;
        const availableSeats = doc.totalSeats - allocatedSeats;
        return availableSeats >= minAvailableSeats;
      });
    }

    // Limit to requested page size after filtering
    docs = docs.slice(0, limit);

    // Get total count (with all filters applied)
    // For accurate count, we need to apply all filters
    let totalDocs = await TripOfferModel.find({
      status: 'published',
      departureAt: { $gt: new Date() },
      ...(qOrigin && {
        'origin.text': { $regex: qOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
      }),
      ...(qDestination && {
        'destination.text': { $regex: qDestination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
      }),
      ...(fromDate && { departureAt: { ...query.departureAt, $gte: new Date(fromDate) } }),
      ...(toDate && { departureAt: { ...query.departureAt, $lte: new Date(toDate) } }),
      ...(minPrice !== undefined && { pricePerSeat: { $gte: minPrice } }),
      ...(maxPrice !== undefined && { pricePerSeat: { $lte: maxPrice } })
    }).lean();

    // Apply time and seat filters to total count
    if (fromTime || toTime) {
      totalDocs = totalDocs.filter(doc => {
        const departure = new Date(doc.departureAt);
        const hour = departure.getHours();
        const minute = departure.getMinutes();
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        
        if (fromTime && timeStr < fromTime) return false;
        if (toTime && timeStr > toTime) return false;
        return true;
      });
    }

    if (minAvailableSeats !== undefined) {
      const SeatLedgerModel = require('../database/models/SeatLedgerModel');
      const tripIds = totalDocs.map(doc => doc._id);
      const ledgers = await SeatLedgerModel.find({ tripId: { $in: tripIds } }).lean();
      const ledgerMap = new Map(ledgers.map(l => [l.tripId.toString(), l.allocatedSeats]));

      totalDocs = totalDocs.filter(doc => {
        const allocatedSeats = ledgerMap.get(doc._id.toString()) || 0;
        const availableSeats = doc.totalSeats - allocatedSeats;
        return availableSeats >= minAvailableSeats;
      });
    }

    const total = totalDocs.length;

    return {
      trips: this._toDomainArray(docs),
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Find published trips past their estimated arrival time (US-3.4.4)
   * Used for auto-completion job
   * 
   * @param {Date} now - Current timestamp
   * @returns {Promise<TripOffer[]>} Array of eligible trips
   */
  async findPublishedPastArrival(now) {
    const docs = await TripOfferModel.find({
      status: 'published',
      estimatedArrivalAt: { $lt: now }
    }).lean();

    return this._toDomainArray(docs);
  }

  /**
   * Bulk update trips to completed status (US-3.4.4)
   * Idempotent: Only updates trips with status='published'
   * 
   * @param {string[]} tripIds - Array of trip IDs to complete
   * @returns {Promise<number>} Count of updated trips
   */
  async bulkCompleteTrips(tripIds) {
    if (!tripIds || tripIds.length === 0) {
      return 0;
    }

    const result = await TripOfferModel.updateMany(
      {
        _id: { $in: tripIds },
        status: 'published' // Only complete published trips (idempotent guard)
      },
      {
        $set: {
          status: 'completed',
          updatedAt: new Date()
        }
      }
    );

    return result.modifiedCount;
  }
}

module.exports = MongoTripOfferRepository;
