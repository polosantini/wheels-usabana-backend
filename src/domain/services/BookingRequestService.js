/**
 * BookingRequestService
 * 
 * Business logic for booking request management.
 * Enforces domain invariants and orchestrates repositories.
 * 
 * Invariants enforced:
 * 1. Trip must be 'published' and have future departureAt
 * 2. Passenger cannot have duplicate active requests for same trip
 * 3. Cancellation is idempotent (canceled_by_passenger)
 */

const DomainError = require('../errors/DomainError');
const InvalidTransitionError = require('../errors/InvalidTransitionError');
const NotificationService = require('./NotificationService');

class BookingRequestService {
  constructor(bookingRequestRepository, tripOfferRepository) {
    this.bookingRequestRepository = bookingRequestRepository;
    this.tripOfferRepository = tripOfferRepository;
  }

  /**
   * Create a new booking request
   * 
   * Validates:
   * - Trip exists, is published, and has future departure
   * - No duplicate active request for same (passenger, trip)
   * 
   * @param {CreateBookingRequestDto} createDto - Booking request data
   * @param {string} passengerId - Requesting passenger ID
   * @returns {Promise<BookingRequest>} Created booking request
   * @throws {DomainError} if validation fails
   */
  async createBookingRequest(createDto, passengerId) {
    const { tripId, seats, note } = createDto;

    console.log(
      `[BookingRequestService] Creating booking request | passengerId: ${passengerId} | tripId: ${tripId} | seats: ${seats}`
    );

    // 1. Verify trip exists
    const trip = await this.tripOfferRepository.findById(tripId);
    if (!trip) {
      console.log(`[BookingRequestService] Trip not found | tripId: ${tripId}`);
      throw new DomainError('Trip offer not found', 'trip_not_found');
    }

    // 2. Verify passenger is not the driver (can't book own trip)
    if (trip.driverId === passengerId) {
      console.log(
        `[BookingRequestService] Driver cannot book own trip | passengerId: ${passengerId} | tripId: ${tripId} | driverId: ${trip.driverId}`
      );
      throw new DomainError(
        'No puedes reservar tu propio viaje',
        'cannot_book_own_trip'
      );
    }

    // 3. Verify trip is published
    if (trip.status !== 'published') {
      console.log(
        `[BookingRequestService] Trip not published | tripId: ${tripId} | status: ${trip.status}`
      );
      throw new DomainError(
        'Cannot request booking for trip that is not published',
        'invalid_trip_state'
      );
    }

    // 4. Verify trip departure is in the future
    if (!trip.isDepartureInFuture()) {
      console.log(
        `[BookingRequestService] Trip departure is in the past | tripId: ${tripId} | departureAt: ${trip.departureAt}`
      );
      throw new DomainError(
        'Cannot request booking for trip with past departure time',
        'invalid_trip_state'
      );
    }

    // 5. Check for duplicate active request
    const existingBooking = await this.bookingRequestRepository.findActiveBooking(
      passengerId,
      tripId
    );

    if (existingBooking) {
      console.log(
        `[BookingRequestService] Duplicate active booking | passengerId: ${passengerId} | tripId: ${tripId} | existingBookingId: ${existingBooking.id}`
      );
      throw new DomainError(
        'You already have an active booking request for this trip',
        'duplicate_request'
      );
    }

    // 6. Soft capacity check (log warning but don't block)
    // Note: Strict capacity enforcement happens during driver acceptance (future story)
    const activeBookingsCount = await this.bookingRequestRepository.countActiveBookingsForTrip(tripId);
    const requestedTotalSeats = activeBookingsCount + seats;
    
    if (requestedTotalSeats > trip.totalSeats) {
      console.log(
        `[BookingRequestService] Request may exceed capacity (soft check) | tripId: ${tripId} | totalSeats: ${trip.totalSeats} | activeBookings: ${activeBookingsCount} | requestedSeats: ${seats}`
      );
      // Don't throw error - allow request to be created (driver will decide during acceptance)
    }

    // 7. Create booking request
    const bookingRequest = await this.bookingRequestRepository.create({
      tripId,
      passengerId,
      seats,
      note: note || ''
    });

    console.log(
      `[BookingRequestService] Booking request created | bookingId: ${bookingRequest.id} | passengerId: ${passengerId} | tripId: ${tripId} | status: ${bookingRequest.status}`
    );

    // Notify driver of new booking request
    await NotificationService.createNotification(
      trip.driverId,
      'booking.new',
      'Nueva solicitud de reserva',
      `Tienes una nueva solicitud de reserva para tu viaje.`,
      {
        bookingId: bookingRequest.id,
        tripId: trip.id,
        passengerId: passengerId,
        seats: bookingRequest.seats
      }
    );

    return bookingRequest;
  }

  /**
   * Get booking request by ID
   * @param {string} bookingId - Booking request ID
   * @returns {Promise<BookingRequest|null>}
   */
  async getBookingRequestById(bookingId) {
    return this.bookingRequestRepository.findById(bookingId);
  }

  /**
   * List booking requests for a passenger
   * @param {string} passengerId - Passenger ID
   * @param {Object} filters - Optional filters (status, page, limit)
   * @returns {Promise<Object>} Paginated results
   */
  async listBookingRequests(passengerId, filters = {}) {
    return this.bookingRequestRepository.findByPassenger(passengerId, filters);
  }

  /**
   * List booking requests with populated trip data
   * Used by controller for API responses
   * @param {string} passengerId - Passenger ID
   * @param {Object} filters - Optional filters
   * @returns {Promise<Object>} Paginated results with populated trip data
   */
  async listBookingRequestsWithTrip(passengerId, filters = {}) {
    return this.bookingRequestRepository.findByPassengerWithTrip(passengerId, filters);
  }

  /**
   * Cancel a booking request (passenger-initiated)
   * 
   * Validates:
   * - Booking exists
   * - Passenger owns the booking
   * - Idempotent: if already canceled, returns success
   * 
   * @param {string} bookingId - Booking request ID
   * @param {string} passengerId - Canceling passenger ID
   * @returns {Promise<BookingRequest>} Canceled booking request
   * @throws {DomainError} if validation fails
   */
  /**
   * Cancel a booking request (passenger-initiated) - US-3.4.3
   * 
   * For accepted bookings: Uses MongoDB transaction to atomically:
   * 1. Update booking status to canceled_by_passenger
   * 2. Deallocate seats from SeatLedger
   * 3. Set refundNeeded flag based on payment policy (for future US-4.2)
   * 4. Store cancellation reason for audit trail
   * 
   * For pending bookings: Simple status update (no transaction needed)
   * 
   * @param {string} bookingId - Booking request ID
   * @param {string} passengerId - Passenger requesting cancellation
   * @param {string} reason - Optional cancellation reason for audit trail
   * @param {MongoSeatLedgerRepository} seatLedgerRepository - Injected for accepted bookings
   * @returns {Promise<Object>} Cancellation result with effects { bookingId, status, effects: { ledgerReleased, refundCreated } }
   * @throws {DomainError} if booking not found or ownership violation
   * @throws {InvalidTransitionError} if booking status doesn't allow cancellation
   */
  async cancelBookingRequest(bookingId, passengerId, reason = '', seatLedgerRepository = null) {
    console.log(
      `[BookingRequestService] Canceling booking request | bookingId: ${bookingId} | passengerId: ${passengerId} | reason: ${reason ? 'provided' : 'none'}`
    );

    // 1. Find booking request
    const bookingRequest = await this.bookingRequestRepository.findById(bookingId);
    if (!bookingRequest) {
      console.log(`[BookingRequestService] Booking not found | bookingId: ${bookingId}`);
      throw new DomainError('Booking request not found', 'booking_not_found', 404);
    }

    // 2. Verify ownership
    if (!bookingRequest.belongsToPassenger(passengerId)) {
      console.log(
        `[BookingRequestService] Ownership violation | bookingId: ${bookingId} | passengerId: ${passengerId} | ownerId: ${bookingRequest.passengerId}`
      );
      throw new DomainError('You cannot modify this booking request', 'forbidden_owner', 403);
    }

    // 3. Check if already canceled (idempotent)
    if (bookingRequest.isCanceledByPassenger()) {
      console.log(
        `[BookingRequestService] Booking already canceled (idempotent) | bookingId: ${bookingId} | passengerId: ${passengerId}`
      );
      return {
        bookingId: bookingRequest.id,
        status: 'canceled_by_passenger',
        effects: {
          ledgerReleased: 0,
          refundCreated: false
        }
      };
    }

    // 4. Validate state transition using entity guard
    if (!bookingRequest.isCancelableByPassenger()) {
      console.log(
        `[BookingRequestService] Cannot cancel booking with status: ${bookingRequest.status} | bookingId: ${bookingId}`
      );
      throw new InvalidTransitionError(
        `Request cannot be canceled in its current state`,
        bookingRequest.status,
        'canceled_by_passenger',
        409
      );
    }

    // 5. Determine if seat deallocation is needed (accepted bookings only)
    const needsDeallocation = bookingRequest.needsSeatDeallocation();
    const seatsToRelease = needsDeallocation ? bookingRequest.seats : 0;

    if (needsDeallocation) {
      // Accepted booking: Use transaction for atomic operation
      if (!seatLedgerRepository) {
        throw new DomainError(
          'Seat ledger repository required for accepted booking cancellation',
          'missing_dependency',
          500
        );
      }

      console.log(
        `[BookingRequestService] Canceling accepted booking (transaction) | bookingId: ${bookingId} | tripId: ${bookingRequest.tripId} | seats: ${bookingRequest.seats}`
      );

      // Payment functionality removed - no payment/refund logic needed
      try {
        // Use entity method to update status and store reason
        bookingRequest.cancelByPassenger(false, false, reason);

        // Execute transaction
        const canceledBooking = await this.bookingRequestRepository.cancelWithTransaction(
          bookingRequest,
          seatLedgerRepository
        );

        console.log(
          `[BookingRequestService] Accepted booking canceled | bookingId: ${bookingId} | tripId: ${bookingRequest.tripId} | seats: ${bookingRequest.seats} | refundNeeded: ${bookingRequest.refundNeeded}`
        );

        // Notify passenger and driver about cancellation
        const trip = await this.tripOfferRepository.findById(bookingRequest.tripId);
        if (trip) {
          // Notify passenger
          await NotificationService.createNotification(
            bookingRequest.passengerId,
            'booking.canceled',
            'Reserva cancelada',
            'Tu reserva ha sido cancelada exitosamente.',
            {
              bookingId: canceledBooking.id,
              tripId: trip.id,
              seats: canceledBooking.seats
            }
          );

          // Notify driver
          await NotificationService.createNotification(
            trip.driverId,
            'booking.canceled_by_passenger',
            'Reserva cancelada por pasajero',
            `Un pasajero ha cancelado su reserva para tu viaje.`,
            {
              bookingId: canceledBooking.id,
              tripId: trip.id,
              passengerId: bookingRequest.passengerId,
              seats: canceledBooking.seats
            }
          );
        }

        // Return effects summary
        return {
          bookingId: canceledBooking.id,
          status: 'canceled_by_passenger',
          effects: {
            ledgerReleased: seatsToRelease,
            refundCreated: false // Payment functionality removed
          }
        };
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          console.log(
            `[BookingRequestService] Invalid state transition | bookingId: ${bookingId} | currentState: ${error.details.currentState} | attemptedState: ${error.details.attemptedState}`
          );
          throw error;
        }

        console.error(
          `[BookingRequestService] Transaction failed during booking cancellation | bookingId: ${bookingId} | error: ${error.message}`
        );
        throw new DomainError('Failed to cancel booking atomically', 'transaction_failed', 500);
      }
    } else {
      // Pending booking: Simple status update (no transaction needed)
      console.log(
        `[BookingRequestService] Canceling pending booking (simple) | bookingId: ${bookingId}`
      );

      // Use entity method for consistency (throws InvalidTransitionError if illegal)
      try {
        bookingRequest.cancelByPassenger(false, false, reason); // Pending bookings: no payment/refund
        const canceledBooking = await this.bookingRequestRepository.cancel(bookingId, reason);

        console.log(
          `[BookingRequestService] Pending booking canceled | bookingId: ${bookingId} | previousStatus: pending`
        );

        // Notify passenger and driver about cancellation
        const trip = await this.tripOfferRepository.findById(bookingRequest.tripId);
        if (trip) {
          // Notify passenger
          await NotificationService.createNotification(
            bookingRequest.passengerId,
            'booking.canceled',
            'Reserva cancelada',
            'Tu solicitud de reserva ha sido cancelada.',
            {
              bookingId: canceledBooking.id,
              tripId: trip.id,
              seats: canceledBooking.seats
            }
          );

          // Notify driver
          await NotificationService.createNotification(
            trip.driverId,
            'booking.canceled_by_passenger',
            'Solicitud de reserva cancelada',
            `Un pasajero ha cancelado su solicitud de reserva para tu viaje.`,
            {
              bookingId: canceledBooking.id,
              tripId: trip.id,
              passengerId: bookingRequest.passengerId,
              seats: canceledBooking.seats
            }
          );
        }

        // Return effects summary
        return {
          bookingId: canceledBooking.id,
          status: 'canceled_by_passenger',
          effects: {
            ledgerReleased: 0, // Pending bookings don't have seats in ledger
            refundCreated: false // Pending bookings don't trigger refunds
          }
        };
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          console.log(
            `[BookingRequestService] Invalid state transition | bookingId: ${bookingId} | currentState: ${error.details.currentState} | attemptedState: ${error.details.attemptedState}`
          );
          throw error;
        }
        throw error;
      }
    }
  }

  /**
   * Accept a booking request (driver-initiated)
   * 
   * Atomic operation using MongoDB session/transaction:
   * 1. Verify booking is pending and trip is owned by driver
   * 2. Verify trip is published and has future departure
   * 3. Atomically allocate seats in SeatLedger (race-safe)
   * 4. Update booking status to 'accepted'
   * 
   * @param {string} bookingId - Booking request ID
   * @param {string} driverId - Accepting driver ID
   * @param {Object} seatLedgerRepository - Seat ledger repository
   * @returns {Promise<BookingRequest>} Accepted booking request
   * @throws {DomainError} if validation fails or capacity exceeded
   */
  async acceptBookingRequest(bookingId, driverId, seatLedgerRepository) {
    console.log(
      `[BookingRequestService] Accepting booking request | bookingId: ${bookingId} | driverId: ${driverId}`
    );

    // 1. Find booking request
    const bookingRequest = await this.bookingRequestRepository.findById(bookingId);
    if (!bookingRequest) {
      console.log(`[BookingRequestService] Booking not found | bookingId: ${bookingId}`);
      throw new DomainError('Booking request not found', 'booking_not_found');
    }

    // 2. Verify booking is pending
    if (bookingRequest.status !== 'pending') {
      console.log(
        `[BookingRequestService] Cannot accept booking with status: ${bookingRequest.status} | bookingId: ${bookingId}`
      );
      throw new DomainError(
        `Cannot accept booking with status: ${bookingRequest.status}. Only pending bookings can be accepted.`,
        'invalid_state'
      );
    }

    // 3. Load trip offer
    const trip = await this.tripOfferRepository.findById(bookingRequest.tripId);
    if (!trip) {
      console.log(
        `[BookingRequestService] Trip not found | tripId: ${bookingRequest.tripId}`
      );
      throw new DomainError('Trip offer not found', 'trip_not_found');
    }

    // 4. Verify trip ownership
    if (trip.driverId !== driverId) {
      console.log(
        `[BookingRequestService] Ownership violation | tripId: ${trip.id} | driverId: ${driverId} | ownerId: ${trip.driverId}`
      );
      throw new DomainError('You do not own this trip', 'forbidden_owner');
    }

    // 5. Verify trip is published
    if (trip.status !== 'published') {
      console.log(
        `[BookingRequestService] Trip not published | tripId: ${trip.id} | status: ${trip.status}`
      );
      throw new DomainError(
        `Cannot accept booking for trip with status: ${trip.status}`,
        'trip_not_published'
      );
    }

    // 6. Verify trip departure is in the future
    if (!trip.isDepartureInFuture()) {
      console.log(
        `[BookingRequestService] Trip departure is in the past | tripId: ${trip.id} | departureAt: ${trip.departureAt}`
      );
      throw new DomainError(
        'Cannot accept booking for trip with past departure time',
        'trip_in_past'
      );
    }

    // 7. Atomically allocate seats (race-safe)
    // This uses findOneAndUpdate with conditional guards to prevent oversubscription
    const SeatLedgerModel = require('../../infrastructure/database/models/SeatLedgerModel');
    let ledger;
    
    try {
      ledger = await SeatLedgerModel.allocateSeats(
        trip.id,
        trip.totalSeats,
        bookingRequest.seats
      );
    } catch (error) {
      if (error.message === 'CAPACITY_EXCEEDED') {
        console.log(
          `[BookingRequestService] Capacity exceeded | tripId: ${trip.id} | totalSeats: ${trip.totalSeats} | requestedSeats: ${bookingRequest.seats}`
        );
        throw new DomainError('No seats available for this trip', 'capacity_exceeded');
      }
      throw error;
    }

    if (!ledger) {
      // Atomic operation failed (capacity guard condition not met)
      console.log(
        `[BookingRequestService] Capacity exceeded (atomic guard failed) | tripId: ${trip.id} | totalSeats: ${trip.totalSeats} | requestedSeats: ${bookingRequest.seats}`
      );
      throw new DomainError('No seats available for this trip', 'capacity_exceeded');
    }

    // 8. Update booking status to 'accepted'
    const acceptedBooking = await this.bookingRequestRepository.accept(bookingId, driverId);

    console.log(
      `[BookingRequestService] Booking request accepted | bookingId: ${bookingId} | driverId: ${driverId} | passengerId: ${bookingRequest.passengerId} | seats: ${bookingRequest.seats} | allocatedSeats: ${ledger.allocatedSeats}`
    );

    // Notify passenger that booking was accepted
    await NotificationService.createNotification(
      bookingRequest.passengerId,
      'booking.accepted',
      'Reserva aceptada',
      `Tu solicitud de reserva ha sido aceptada por el conductor.`,
      {
        bookingId: acceptedBooking.id,
        tripId: trip.id,
        driverId: driverId,
        seats: acceptedBooking.seats
      }
    );

    return acceptedBooking;
  }

  /**
   * Decline a booking request (driver-initiated)
   * 
   * Validates:
   * - Booking exists and is pending
   * - Trip is owned by driver
   * - Idempotent: if already declined, returns success
   * 
   * No seat allocation changes (capacity unchanged)
   * 
   * @param {string} bookingId - Booking request ID
   * @param {string} driverId - Declining driver ID
   * @returns {Promise<BookingRequest>} Declined booking request
   * @throws {DomainError} if validation fails
   */
  async declineBookingRequest(bookingId, driverId, reason = null) {
    console.log(
      `[BookingRequestService] Declining booking request | bookingId: ${bookingId} | driverId: ${driverId} | reason: ${reason}`
    );

    // 1. Find booking request
    const bookingRequest = await this.bookingRequestRepository.findById(bookingId);
    if (!bookingRequest) {
      console.log(`[BookingRequestService] Booking not found | bookingId: ${bookingId}`);
      throw new DomainError('Booking request not found', 'booking_not_found');
    }

    // 2. Load trip offer
    const trip = await this.tripOfferRepository.findById(bookingRequest.tripId);
    if (!trip) {
      console.log(
        `[BookingRequestService] Trip not found | tripId: ${bookingRequest.tripId}`
      );
      throw new DomainError('Trip offer not found', 'trip_not_found');
    }

    // 3. Verify trip ownership
    if (trip.driverId !== driverId) {
      console.log(
        `[BookingRequestService] Ownership violation | tripId: ${trip.id} | driverId: ${driverId} | ownerId: ${trip.driverId}`
      );
      throw new DomainError('You do not own this trip', 'forbidden_owner');
    }

    // 4. Check if already declined (idempotent)
    if (bookingRequest.status === 'declined') {
      console.log(
        `[BookingRequestService] Booking already declined (idempotent) | bookingId: ${bookingId} | driverId: ${driverId}`
      );
      return bookingRequest; // Return without error
    }

    // 5. Verify booking is pending
    if (bookingRequest.status !== 'pending') {
      console.log(
        `[BookingRequestService] Cannot decline booking with status: ${bookingRequest.status} | bookingId: ${bookingId}`
      );
      throw new DomainError(
        `Cannot decline booking with status: ${bookingRequest.status}. Only pending bookings can be declined.`,
        'invalid_state'
      );
    }

    // 6. Decline booking request (no seat allocation changes)
    const declinedBooking = await this.bookingRequestRepository.decline(bookingId, driverId, reason);

    console.log(
      `[BookingRequestService] Booking request declined | bookingId: ${bookingId} | driverId: ${driverId} | passengerId: ${bookingRequest.passengerId}`
    );

    // Notify passenger that booking was declined
    await NotificationService.createNotification(
      bookingRequest.passengerId,
      'booking.declined',
      'Reserva rechazada',
      reason ? `Tu solicitud de reserva fue rechazada: ${reason}` : 'Tu solicitud de reserva fue rechazada por el conductor.',
      {
        bookingId: declinedBooking.id,
        tripId: trip.id,
        driverId: driverId,
        reason: reason || null
      }
    );

    return declinedBooking;
  }

  /**
   * Get booking requests for a trip (driver view)
   * 
   * Validates:
   * - Trip exists
   * - Trip is owned by the driver
   * 
   * @param {string} tripId - Trip ID
   * @param {string} driverId - Driver ID (ownership validation)
   * @param {Object} filters - Optional filters
   * @param {string|string[]} filters.status - Status filter
   * @param {number} filters.page - Page number
   * @param {number} filters.pageSize - Results per page (max: 50)
   * @returns {Promise<Object>} Paginated booking requests
   * @throws {DomainError} if trip not found or not owned by driver
   */
  async getBookingRequestsForTrip(tripId, driverId, { status, page = 1, pageSize = 10 } = {}) {
    console.log(
      `[BookingRequestService] Fetching booking requests for trip | tripId: ${tripId} | driverId: ${driverId} | status: ${status} | page: ${page} | pageSize: ${pageSize}`
    );

    // 1. Verify trip exists
    const trip = await this.tripOfferRepository.findById(tripId);
    if (!trip) {
      console.log(`[BookingRequestService] Trip not found | tripId: ${tripId}`);
      throw new DomainError('Trip offer not found', 'trip_not_found');
    }

    // 2. Verify trip ownership
    if (trip.driverId !== driverId) {
      console.log(
        `[BookingRequestService] Ownership violation | tripId: ${tripId} | driverId: ${driverId} | ownerId: ${trip.driverId}`
      );
      throw new DomainError('Trip does not belong to the driver', 'forbidden_owner');
    }

    // 3. Fetch booking requests with filters
    const result = await this.bookingRequestRepository.findByTrip(tripId, {
      status,
      page,
      limit: pageSize
    });

    console.log(
      `[BookingRequestService] Fetched booking requests | tripId: ${tripId} | total: ${result.total} | page: ${result.page}`
    );

    return result;
  }

  /**
   * Auto-expire old pending bookings (US-3.4.4)
   * 
   * Marks pending bookings as expired when they exceed the configured TTL.
   * Idempotent: Already-expired bookings are skipped.
   * 
   * Used by background jobs or manual admin trigger.
   * 
   * @param {number} ttlHours - Time-to-live in hours (default: 48 hours)
   * @returns {Promise<number>} Count of bookings marked as expired
   */
  async expirePendingBookings(ttlHours = 48) {
    console.log(`[BookingRequestService] Running expire pending bookings job | TTL: ${ttlHours}h`);

    // Calculate cutoff time (now - TTL hours)
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);

    console.log(
      `[BookingRequestService] Expiring pending bookings older than | cutoff: ${cutoffTime.toISOString()} | now: ${now.toISOString()}`
    );

    // Use bulk update for efficiency
    const expiredCount = await this.bookingRequestRepository.bulkExpireOldPendings(cutoffTime);

    console.log(
      `[BookingRequestService] Expired ${expiredCount} pending bookings | cutoff: ${cutoffTime.toISOString()}`
    );

    return expiredCount;
  }
}

module.exports = BookingRequestService;
