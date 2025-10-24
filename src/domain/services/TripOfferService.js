const TripOffer = require('../entities/TripOffer');
const CreateTripOfferDto = require('../dtos/CreateTripOfferDto');
const UpdateTripOfferDto = require('../dtos/UpdateTripOfferDto');
const ValidationError = require('../errors/ValidationError');
const DomainError = require('../errors/DomainError');
const InvalidTransitionError = require('../errors/InvalidTransitionError');

/**
 * Trip Offer Service
 * Business logic for trip offer management with ownership and temporal invariants
 */
class TripOfferService {
  constructor(tripOfferRepository, vehicleRepository, userRepository) {
    this.tripOfferRepository = tripOfferRepository;
    this.vehicleRepository = vehicleRepository;
    this.userRepository = userRepository;
  }

  /**
   * Create a new trip offer
   * Validates driver-vehicle ownership, temporal constraints, and optional overlap check
   */
  async createTripOffer(driverId, createDto, { checkOverlap = true } = {}) {
    // Validate DTO
    const dtoErrors = createDto.validate();
    if (dtoErrors.length > 0) {
      throw new ValidationError(`Invalid trip offer data: ${dtoErrors.join(', ')}`);
    }

    // Validate driver exists and has role 'driver'
    const driver = await this.userRepository.findById(driverId);
    if (!driver) {
      throw new DomainError('Driver not found', 'driver_not_found');
    }

    if (driver.role !== 'driver') {
      throw new DomainError('User is not a driver', 'not_a_driver');
    }

    // Validate vehicle exists and is owned by the driver
    const vehicle = await this.vehicleRepository.findById(createDto.vehicleId);
    if (!vehicle) {
      throw new DomainError('Vehicle not found', 'vehicle_not_found');
    }

    if (vehicle.driverId !== driverId) {
      throw new DomainError(
        'Vehicle does not belong to the driver',
        'vehicle_ownership_violation'
      );
    }

    // Validate totalSeats does not exceed vehicle capacity
    if (createDto.totalSeats > vehicle.capacity) {
      throw new DomainError(
        `totalSeats (${createDto.totalSeats}) exceeds vehicle capacity (${vehicle.capacity})`,
        'exceeds_vehicle_capacity'
      );
    }

    // Parse dates
    const departureAt = new Date(createDto.departureAt);
    const estimatedArrivalAt = new Date(createDto.estimatedArrivalAt);

    // Validate departureAt is in the future (only for published trips)
    if (createDto.status === 'published' && departureAt <= new Date()) {
      throw new DomainError('departureAt must be in the future', 'departure_in_past');
    }

    // Validate estimatedArrivalAt > departureAt
    if (estimatedArrivalAt <= departureAt) {
      throw new DomainError(
        'estimatedArrivalAt must be after departureAt',
        'invalid_time_range'
      );
    }

    // Optional: Check for overlapping published trips
    if (checkOverlap && createDto.status === 'published') {
      const overlappingTrips = await this.tripOfferRepository.findOverlappingTrips(
        driverId,
        departureAt,
        estimatedArrivalAt
      );

      if (overlappingTrips.length > 0) {
        throw new DomainError(
          'You have another overlapping published trip during this time window',
          'overlapping_trip'
        );
      }
    }

    // Create trip offer
    const tripData = {
      driverId,
      vehicleId: createDto.vehicleId,
      origin: createDto.origin,
      destination: createDto.destination,
      departureAt,
      estimatedArrivalAt,
      pricePerSeat: createDto.pricePerSeat,
      totalSeats: createDto.totalSeats,
      status: createDto.status,
      notes: createDto.notes
    };

    const tripOffer = await this.tripOfferRepository.create(tripData);

    console.log(
      `[TripOfferService] Trip offer created | tripId: ${tripOffer.id} | driverId: ${driverId} | status: ${tripOffer.status} | departure: ${tripOffer.departureAt.toISOString()}`
    );

    return tripOffer;
  }

  /**
   * Get trip offer by ID
   */
  async getTripOfferById(tripId) {
    const tripOffer = await this.tripOfferRepository.findById(tripId);
    if (!tripOffer) {
      throw new DomainError('Trip offer not found', 'trip_not_found');
    }
    return tripOffer;
  }

  /**
   * Get trip offers by driver ID
   */
  async getTripOffersByDriver(driverId, filters = {}) {
    return this.tripOfferRepository.findByDriverId(driverId, filters);
  }

  /**
   * List trip offers with pagination and filters
   */
  async listTripOffers(filters = {}, options = {}) {
    const { page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;

    // Get total count
    const TripOfferModel = require('../../infrastructure/database/models/TripOfferModel');
    const total = await TripOfferModel.countDocuments(filters);

    // Get paginated results (sorted by departure date descending - most recent first)
    const docs = await TripOfferModel
      .find(filters)
      .sort({ departureAt: -1 })
      .skip(skip)
      .limit(limit);

    // Map to domain entities using repository private method
    const TripOffer = require('../entities/TripOffer');
    const trips = docs.map(doc => {
      return new TripOffer({
        id: doc._id.toString(),
        driverId: doc.driverId.toString(),
        vehicleId: doc.vehicleId.toString(),
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
    });

    return {
      data: trips,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Update trip offer
   * Validates ownership, mutable fields, status transitions, and capacity constraints
   */
  async updateTripOffer(tripId, driverId, updateDto, { checkOverlap = true } = {}) {
    // Validate DTO
    const dtoErrors = updateDto.validate();
    if (dtoErrors.length > 0) {
      throw new ValidationError(`Invalid update data: ${dtoErrors.join(', ')}`);
    }

    if (!updateDto.hasUpdates()) {
      throw new ValidationError('No fields to update');
    }

    // Find trip offer
    const tripOffer = await this.tripOfferRepository.findById(tripId);
    if (!tripOffer) {
      throw new DomainError('Trip offer not found', 'trip_not_found');
    }

    // Validate ownership
    if (tripOffer.driverId !== driverId) {
      throw new DomainError('You do not own this trip offer', 'ownership_violation');
    }

    // Status guard: Cannot update canceled or completed trips (except notes)
    if ((tripOffer.status === 'canceled' || tripOffer.status === 'completed') && 
        (updateDto.pricePerSeat !== undefined || updateDto.totalSeats !== undefined || updateDto.status !== undefined)) {
      throw new DomainError(
        `Cannot update ${tripOffer.status} trip (only notes can be updated)`,
        'invalid_status_for_update'
      );
    }

    // Validate status transition
    if (updateDto.status && !tripOffer.canTransitionTo(updateDto.status)) {
      throw new DomainError(
        `Invalid status transition from ${tripOffer.status} to ${updateDto.status}`,
        'invalid_status_transition'
      );
    }

    // If publishing a draft, validate departureAt is still in the future
    if (updateDto.status === 'published' && tripOffer.status === 'draft') {
      if (!tripOffer.isDepartureInFuture()) {
        throw new DomainError('Cannot publish trip with past departure time', 'departure_in_past');
      }
    }

    // Validate totalSeats does not exceed vehicle capacity
    if (updateDto.totalSeats !== undefined) {
      const vehicle = await this.vehicleRepository.findById(tripOffer.vehicleId);
      if (!vehicle) {
        throw new DomainError('Vehicle not found', 'vehicle_not_found');
      }
      if (updateDto.totalSeats > vehicle.capacity) {
        throw new DomainError(
          `totalSeats (${updateDto.totalSeats}) exceeds vehicle capacity (${vehicle.capacity})`,
          'exceeds_vehicle_capacity'
        );
      }

      // Future: Cannot reduce totalSeats below already-booked seats
      // This check will be implemented in later story when booking logic exists
      // For now, just log a warning
      console.log(
        `[TripOfferService] totalSeats updated | tripId: ${tripId} | oldValue: ${tripOffer.totalSeats} | newValue: ${updateDto.totalSeats}`
      );
    }

    // Optional: Check for overlapping trips if status changes to published
    if (checkOverlap && updateDto.status === 'published' && tripOffer.status !== 'published') {
      const overlappingTrips = await this.tripOfferRepository.findOverlappingTrips(
        driverId,
        tripOffer.departureAt,
        tripOffer.estimatedArrivalAt,
        tripId
      );

      if (overlappingTrips.length > 0) {
        throw new DomainError(
          'You have another overlapping published trip during this time window',
          'overlapping_trip'
        );
      }
    }

    // Prepare updates
    const updates = {};
    if (updateDto.pricePerSeat !== undefined) updates.pricePerSeat = updateDto.pricePerSeat;
    if (updateDto.totalSeats !== undefined) updates.totalSeats = updateDto.totalSeats;
    if (updateDto.notes !== undefined) updates.notes = updateDto.notes;
    if (updateDto.status !== undefined) updates.status = updateDto.status;

    // Update trip offer
    const updatedTripOffer = await this.tripOfferRepository.update(tripId, updates);

    console.log(
      `[TripOfferService] Trip offer updated | tripId: ${tripId} | driverId: ${driverId} | updates: ${Object.keys(updates).join(', ')}`
    );

    return updatedTripOffer;
  }

  /**
   * Cancel (soft delete) trip offer
   * Legal transitions: published|draft → canceled
   * Idempotent: If already canceled, returns the trip without error
   * Future: Will cascade to bookings (US-3.4 next subtask)
   * 
   * @param {string} tripId - Trip ID to cancel
   * @param {string} driverId - Driver ID (ownership validation)
   * @returns {Promise<TripOffer>} Canceled trip offer
   * @throws {DomainError} if trip not found or ownership violation
   * @throws {InvalidTransitionError} if trip cannot be canceled from current state
   */
  async cancelTripOffer(tripId, driverId) {
    console.log(`[TripOfferService] Attempting to cancel trip | tripId: ${tripId} | driverId: ${driverId}`);

    // Find trip offer
    const tripOffer = await this.tripOfferRepository.findById(tripId);
    if (!tripOffer) {
      throw new DomainError('Trip offer not found', 'trip_not_found', 404);
    }

    // Validate ownership
    if (tripOffer.driverId !== driverId) {
      throw new DomainError('Trip does not belong to the driver', 'ownership_violation', 403);
    }

    // Idempotent: If already canceled, return it (no error)
    if (tripOffer.status === 'canceled') {
      console.log(
        `[TripOfferService] Trip already canceled (idempotent) | tripId: ${tripId} | driverId: ${driverId}`
      );
      return tripOffer;
    }

    // Use entity's cancel() method which enforces legal transitions
    // This will throw InvalidTransitionError if illegal (e.g., completed → canceled)
    try {
      tripOffer.cancel();
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        console.log(
          `[TripOfferService] Invalid transition | tripId: ${tripId} | currentState: ${error.currentState} | attemptedState: ${error.attemptedState}`
        );
        throw error;
      }
      throw error;
    }

    // Persist cancellation
    const canceledTripOffer = await this.tripOfferRepository.update(tripId, {
      status: tripOffer.status,
      updatedAt: tripOffer.updatedAt
    });

    console.log(
      `[TripOfferService] Trip offer canceled | tripId: ${tripId} | driverId: ${driverId} | previousStatus: ${tripOffer.status}`
    );

    // TODO (US-3.4 next subtask): Cascade to bookings
    // - pending → declined_auto
    // - accepted → canceled_by_platform (with refund trigger)

    return canceledTripOffer;
  }

  /**
   * Cancel trip offer with cascade to all bookings (US-3.4.2)
   * 
   * Atomically:
   * 1. Cancel trip (published|draft → canceled)
   * 2. Decline all pending bookings (→ declined_auto)
   * 3. Cancel all accepted bookings (→ canceled_by_platform)
   * 4. Deallocate seats from ledger for each accepted booking
   * 5. Set refundNeeded flag for paid accepted bookings
   * 
   * @param {string} tripId - Trip ID to cancel
   * @param {string} driverId - Driver ID (ownership validation)
   * @param {MongoBookingRequestRepository} bookingRequestRepository - Injected for cascade
   * @param {MongoSeatLedgerRepository} seatLedgerRepository - Injected for seat deallocation
   * @returns {Promise<Object>} Cancellation result with effects summary
   * @throws {DomainError} if trip not found or ownership violation (403)
   * @throws {InvalidTransitionError} if trip cannot be canceled from current state (409)
   */
  async cancelTripWithCascade(tripId, driverId, bookingRequestRepository, seatLedgerRepository) {
    console.log(
      `[TripOfferService] Attempting cascade cancellation | tripId: ${tripId} | driverId: ${driverId}`
    );

    // 1. Find trip offer
    const tripOffer = await this.tripOfferRepository.findById(tripId);
    if (!tripOffer) {
      throw new DomainError('Trip offer not found', 'trip_not_found', 404);
    }

    // 2. Validate ownership
    if (tripOffer.driverId !== driverId) {
      console.log(
        `[TripOfferService] Ownership violation | tripId: ${tripId} | driverId: ${driverId} | ownerId: ${tripOffer.driverId}`
      );
      throw new DomainError('Trip does not belong to the driver', 'forbidden_owner', 403);
    }

    // 3. Idempotent: If already canceled, return empty effects
    if (tripOffer.status === 'canceled') {
      console.log(
        `[TripOfferService] Trip already canceled (idempotent) | tripId: ${tripId}`
      );
      return {
        tripId,
        status: 'canceled',
        effects: {
          declinedAuto: 0,
          canceledByPlatform: 0,
          refundsCreated: 0,
          ledgerReleased: 0
        }
      };
    }

    // 4. Validate state transition using entity guard
    try {
      tripOffer.cancel(); // Dry run for validation
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        console.log(
          `[TripOfferService] Invalid transition | tripId: ${tripId} | currentState: ${error.details.currentState} | attemptedState: ${error.details.attemptedState}`
        );
        throw error;
      }
      throw error;
    }

    // 5. Query all bookings for cascade (outside transaction for efficiency)
    const [pendingBookings, acceptedBookings] = await Promise.all([
      bookingRequestRepository.findAllPendingByTrip(tripId),
      bookingRequestRepository.findAllAcceptedByTrip(tripId)
    ]);

    console.log(
      `[TripOfferService] Found bookings for cascade | tripId: ${tripId} | pending: ${pendingBookings.length} | accepted: ${acceptedBookings.length}`
    );

    // 6. Execute cascade transaction
    const TripOfferModel = require('../../infrastructure/database/models/TripOfferModel');
    const session = await TripOfferModel.startSession();

    try {
      let effects = {
        declinedAuto: 0,
        canceledByPlatform: 0,
        refundsCreated: 0,
        ledgerReleased: 0
      };

      await session.withTransaction(async () => {
        // a) Update trip status to canceled
        await TripOfferModel.findByIdAndUpdate(
          tripId,
          {
            status: 'canceled',
            updatedAt: new Date()
          },
          { session }
        );

        // b) Bulk decline all pending bookings (→ declined_auto)
        if (pendingBookings.length > 0) {
          effects.declinedAuto = await bookingRequestRepository.bulkDeclineAuto(tripId, session);
        }

        // c) Bulk cancel all accepted bookings (→ canceled_by_platform)
        // This also sets refundNeeded = true for all (platform cancellations always refund)
        if (acceptedBookings.length > 0) {
          effects.canceledByPlatform = await bookingRequestRepository.bulkCancelByPlatform(
            tripId,
            session
          );

          // d) Deallocate seats for each accepted booking
          // Note: We use the total allocated seats from ledger, not per-booking
          // The ledger tracks aggregate, so we release all at once
          const totalSeatsToRelease = acceptedBookings.reduce((sum, booking) => sum + booking.seats, 0);

          if (totalSeatsToRelease > 0) {
            const ledgerReleased = await seatLedgerRepository.deallocateSeats(
              tripId,
              totalSeatsToRelease
            );

            if (!ledgerReleased) {
              throw new Error(
                `Failed to deallocate seats atomically. Ledger may not exist or would go negative. tripId: ${tripId}, seats: ${totalSeatsToRelease}`
              );
            }

            effects.ledgerReleased = acceptedBookings.length; // Count of bookings, not seats
          }

          // TODO (US-4.2): Create RefundIntents for paid accepted bookings
          // For now, we just count potential refunds (all accepted bookings get refundNeeded=true)
          // The actual refund creation will happen in payment service
          effects.refundsCreated = effects.canceledByPlatform; // Placeholder count
        }
      });

      console.log(
        `[TripOfferService] Cascade completed | tripId: ${tripId} | effects: ${JSON.stringify(effects)}`
      );

      return {
        tripId,
        status: 'canceled',
        effects
      };
    } catch (error) {
      console.error(
        `[TripOfferService] Transaction failed during cascade | tripId: ${tripId} | error: ${error.message}`
      );
      throw new DomainError('Failed to cancel trip atomically', 'transaction_failed', 500);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Get upcoming published trips by driver
   */
  async getUpcomingTripsByDriver(driverId) {
    return this.tripOfferRepository.findUpcomingByDriver(driverId);
  }

  /**
   * Auto-complete eligible trips (US-3.4.4)
   * 
   * Marks published trips as completed when estimatedArrivalAt is in the past.
   * Idempotent: Already-completed trips are skipped.
   * 
   * Used by background jobs or manual admin trigger.
   * 
   * @returns {Promise<number>} Count of trips marked as completed
   */
  async autoCompleteTrips() {
    console.log('[TripOfferService] Running auto-complete trips job');

    // Find all published trips where estimatedArrivalAt < now
    const now = new Date();
    const eligibleTrips = await this.tripOfferRepository.findPublishedPastArrival(now);

    if (eligibleTrips.length === 0) {
      console.log('[TripOfferService] No eligible trips to complete');
      return 0;
    }

    console.log(
      `[TripOfferService] Found ${eligibleTrips.length} eligible trips to complete | now: ${now.toISOString()}`
    );

    // Use bulk update for efficiency
    const completedCount = await this.tripOfferRepository.bulkCompleteTrips(
      eligibleTrips.map((trip) => trip.id)
    );

    console.log(
      `[TripOfferService] Auto-completed ${completedCount} trips | expected: ${eligibleTrips.length}`
    );

    return completedCount;
  }
}

module.exports = TripOfferService;
