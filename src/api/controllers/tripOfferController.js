const TripOfferService = require('../../domain/services/TripOfferService');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const MongoVehicleRepository = require('../../infrastructure/repositories/MongoVehicleRepository');
const MongoUserRepository = require('../../infrastructure/repositories/MongoUserRepository');
const CreateTripOfferDto = require('../../domain/dtos/CreateTripOfferDto');
const UpdateTripOfferDto = require('../../domain/dtos/UpdateTripOfferDto');
const TripOfferResponseDto = require('../../domain/dtos/TripOfferResponseDto');

/**
 * Trip Offer Controller
 * Handles HTTP requests for trip offer management
 */
class TripOfferController {
  constructor() {
    this.tripOfferRepository = new MongoTripOfferRepository();
    this.vehicleRepository = new MongoVehicleRepository();
    this.userRepository = new MongoUserRepository();
    this.tripOfferService = new TripOfferService(
      this.tripOfferRepository,
      this.vehicleRepository,
      this.userRepository
    );
  }

  /**
   * POST /drivers/trips
   * Create a new trip offer
   */
  async createTripOffer(req, res, next) {
    try {
      const driverId = req.user.id; // From authenticate middleware

      console.log(
        `[TripOfferController] Create trip | driverId: ${driverId} | correlationId: ${req.correlationId}`
      );

      // Create DTO from request body
      const createDto = CreateTripOfferDto.fromRequest(req.body);

      // Create trip offer via service
      const tripOffer = await this.tripOfferService.createTripOffer(driverId, createDto);

      // Return response DTO
      const responseDto = TripOfferResponseDto.fromDomain(tripOffer);

      console.log(
        `[TripOfferController] Trip created | tripId: ${tripOffer.id} | status: ${tripOffer.status} | correlationId: ${req.correlationId}`
      );

      res.status(201).json(responseDto);
    } catch (error) {
      console.error(
        `[TripOfferController] Create failed | driverId: ${req.user?.id} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      // Map domain errors to HTTP responses
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          code: 'invalid_schema',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      if (error.code === 'driver_not_found' || error.code === 'vehicle_not_found') {
        return res.status(404).json({
          code: error.code,
          message: error.message,
          correlationId: req.correlationId
        });
      }

      if (error.code === 'not_a_driver') {
        return res.status(403).json({
          code: 'forbidden',
          message: 'Only drivers can create trip offers',
          correlationId: req.correlationId
        });
      }

      if (error.code === 'vehicle_ownership_violation') {
        return res.status(403).json({
          code: 'vehicle_ownership_violation',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      if (
        error.code === 'exceeds_vehicle_capacity' ||
        error.code === 'departure_in_past' ||
        error.code === 'invalid_time_range'
      ) {
        return res.status(400).json({
          code: 'invalid_schema',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      if (error.code === 'overlapping_trip') {
        return res.status(409).json({
          code: 'overlapping_trip',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  /**
   * GET /drivers/trips
   * List trip offers for the authenticated driver with filters
   */
  async listMyTrips(req, res, next) {
    try {
      const driverId = req.user.sub;

      // Extract query parameters (validated by Joi middleware)
      const { status, fromDate, toDate, page = 1, pageSize = 10 } = req.query;

      console.log(
        `[TripOfferController] List trips | driverId: ${driverId} | status: ${status || 'all'} | page: ${page} | pageSize: ${pageSize} | correlationId: ${req.correlationId}`
      );

      // Build filters
      const filters = { driverId };
      
      // Handle status filter (can be string or array)
      if (status) {
        if (Array.isArray(status)) {
          filters.status = { $in: status };
        } else {
          filters.status = status;
        }
      }
      
      // Handle date range filters
      if (fromDate || toDate) {
        filters.departureAt = {};
        if (fromDate) filters.departureAt.$gte = new Date(fromDate);
        if (toDate) filters.departureAt.$lte = new Date(toDate);
      }

      // Get paginated trips via service
      const result = await this.tripOfferService.listTripOffers(filters, {
        page: parseInt(page),
        limit: parseInt(pageSize)
      });

      // Return response with items instead of data
      const response = {
        items: TripOfferResponseDto.fromDomainArray(result.data),
        page: result.pagination.page,
        pageSize: result.pagination.limit,
        total: result.pagination.total,
        totalPages: result.pagination.pages
      };

      res.status(200).json(response);
    } catch (error) {
      console.error(
        `[TripOfferController] List failed | driverId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      next(error);
    }
  }

  /**
   * GET /drivers/trips/:id
   * Get a specific trip offer by ID
   */
  async getTripOfferById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      console.log(
        `[TripOfferController] Get trip | tripId: ${id} | userId: ${userId} | correlationId: ${req.correlationId}`
      );

      const tripOffer = await this.tripOfferService.getTripOfferById(id);

      if (!tripOffer) {
        return res.status(404).json({
          code: 'not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }

      // Check ownership (only owner can view their draft/canceled trips)
      // For now, any authenticated user can view published trips (for passenger discovery)
      const isOwner = tripOffer.driverId === userId;
      const isPublished = tripOffer.status === 'published';

      if (!isOwner && !isPublished) {
        return res.status(403).json({
          code: 'forbidden',
          message: 'You do not have permission to view this trip',
          correlationId: req.correlationId
        });
      }

      const responseDto = TripOfferResponseDto.fromDomain(tripOffer);
      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[TripOfferController] Get trip failed | tripId: ${req.params.id} | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      
      if (error.code === 'trip_not_found') {
        return res.status(404).json({
          code: 'not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }
      
      next(error);
    }
  }

  /**
   * PATCH /drivers/trips/:id
   * Update a trip offer (owner only)
   */
  async updateTripOffer(req, res, next) {
    try {
      const { id } = req.params;
      const driverId = req.user.sub;

      console.log(
        `[TripOfferController] Update trip | tripId: ${id} | driverId: ${driverId} | correlationId: ${req.correlationId}`
      );

      // Create DTO from request body
      const updateDto = UpdateTripOfferDto.fromRequest(req.body);

      // If canceling, use cascade cancellation to notify passengers
      if (updateDto.status === 'canceled') {
        console.log(
          `[TripOfferController] Cancel detected in update, using cascade cancellation | tripId: ${id} | correlationId: ${req.correlationId}`
        );
        
        // Initialize repositories for cascade cancellation
        const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
        const MongoSeatLedgerRepository = require('../../infrastructure/repositories/MongoSeatLedgerRepository');
        const bookingRequestRepository = new MongoBookingRequestRepository();
        const seatLedgerRepository = new MongoSeatLedgerRepository();

        // Use cascade cancellation (includes notifications)
        const result = await this.tripOfferService.cancelTripWithCascade(
          id,
          driverId,
          bookingRequestRepository,
          seatLedgerRepository
        );

        // Map to response format
        const canceledTrip = await this.tripOfferService.getTripOfferById(id);
        const responseDto = TripOfferResponseDto.fromDomain(canceledTrip);

        console.log(
          `[TripOfferController] Trip canceled with cascade | tripId: ${id} | effects: ${JSON.stringify(result.effects)} | correlationId: ${req.correlationId}`
        );

        return res.status(200).json(responseDto);
      }

      // Regular update (not canceling)
      const updatedTrip = await this.tripOfferService.updateTripOffer(id, driverId, updateDto);

      const responseDto = TripOfferResponseDto.fromDomain(updatedTrip);

      console.log(
        `[TripOfferController] Trip updated | tripId: ${id} | status: ${updatedTrip.status} | correlationId: ${req.correlationId}`
      );

      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[TripOfferController] Update failed | tripId: ${req.params.id} | driverId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      // Validation errors from DTO
      if (error.name === 'ValidationError' || error.code === 'invalid_schema') {
        return res.status(400).json({
          code: 'invalid_schema',
          message: error.message,
          details: error.details || [],
          correlationId: req.correlationId
        });
      }

      // Not found
      if (error.code === 'trip_not_found') {
        return res.status(404).json({
          code: 'trip_not_found',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Ownership violation
      if (error.code === 'ownership_violation') {
        return res.status(403).json({
          code: 'forbidden_owner',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Status transition or editing conflicts
      if (
        error.code === 'invalid_status_transition' ||
        error.code === 'invalid_status_for_update' ||
        error.code === 'cannot_edit_published_time'
      ) {
        return res.status(409).json({
          code: 'invalid_transition',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Capacity violations
      if (error.code === 'exceeds_vehicle_capacity' || error.code === 'departure_in_past') {
        return res.status(400).json({
          code: 'invalid_schema',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Overlap conflicts
      if (error.code === 'overlapping_trip') {
        return res.status(409).json({
          code: 'overlapping_trip',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  /**
   * POST /drivers/trips/:id/start
   * Start a trip (change status from published to in_progress)
   */
  async startTrip(req, res, next) {
    try {
      const { id } = req.params;
      const driverId = req.user.sub;

      console.log(
        `[TripOfferController] Start trip | tripId: ${id} | driverId: ${driverId} | correlationId: ${req.correlationId}`
      );

      const startedTrip = await this.tripOfferService.startTrip(id, driverId);
      const responseDto = TripOfferResponseDto.fromDomain(startedTrip);

      console.log(
        `[TripOfferController] Trip started | tripId: ${id} | status: ${startedTrip.status} | correlationId: ${req.correlationId}`
      );

      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[TripOfferController] Start failed | tripId: ${req.params.id} | driverId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      if (error.code === 'trip_not_found') {
        return res.status(404).json({
          code: 'trip_not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }

      if (error.code === 'ownership_violation') {
        return res.status(403).json({
          code: 'forbidden_owner',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      if (error.code === 'invalid_status_transition') {
        return res.status(409).json({
          code: 'invalid_transition',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  /**
   * POST /drivers/trips/:id/complete
   * Complete a trip (change status from in_progress to completed)
   */
  async completeTrip(req, res, next) {
    try {
      const { id } = req.params;
      const driverId = req.user.sub;

      console.log(
        `[TripOfferController] Complete trip | tripId: ${id} | driverId: ${driverId} | correlationId: ${req.correlationId}`
      );

      const completedTrip = await this.tripOfferService.completeTrip(id, driverId);
      const responseDto = TripOfferResponseDto.fromDomain(completedTrip);

      console.log(
        `[TripOfferController] Trip completed | tripId: ${id} | status: ${completedTrip.status} | correlationId: ${req.correlationId}`
      );

      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[TripOfferController] Complete failed | tripId: ${req.params.id} | driverId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      if (error.code === 'trip_not_found') {
        return res.status(404).json({
          code: 'trip_not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }

      if (error.code === 'ownership_violation') {
        return res.status(403).json({
          code: 'forbidden_owner',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      if (error.code === 'invalid_status_transition') {
        return res.status(409).json({
          code: 'invalid_transition',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  /**
   * DELETE /drivers/trips/:id
   * Cancel a trip offer (soft delete)
   */
  async cancelTripOffer(req, res, next) {
    try {
      const { id } = req.params;
      const driverId = req.user.sub; // Using sub instead of id

      console.log(
        `[TripOfferController] Cancel trip | tripId: ${id} | driverId: ${driverId} | correlationId: ${req.correlationId}`
      );

      // Cancel via service (sets status to 'canceled')
      const canceledTrip = await this.tripOfferService.cancelTripOffer(id, driverId);

      const responseDto = TripOfferResponseDto.fromDomain(canceledTrip);

      console.log(
        `[TripOfferController] Trip canceled | tripId: ${id} | status: ${canceledTrip.status} | correlationId: ${req.correlationId}`
      );

      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[TripOfferController] Cancel failed | tripId: ${req.params.id} | driverId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      // Not found
      if (error.code === 'trip_not_found') {
        return res.status(404).json({
          code: 'trip_not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }

      // Ownership violation
      if (error.code === 'ownership_violation') {
        return res.status(403).json({
          code: 'forbidden_owner',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Cannot cancel completed
      if (error.code === 'cannot_cancel_completed') {
        return res.status(409).json({
          code: 'invalid_transition',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      // Already canceled -> Idempotent: return 200 (handled by service)
      if (error.code === 'already_canceled') {
        return res.status(409).json({
          code: 'already_canceled',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  async getTripBookings(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      console.log(
        `[TripOfferController] Get bookings | tripId: ${id} | userId: ${userId} | correlationId: ${req.correlationId}`
      );

      // Verify trip ownership
      const trip = await this.tripOfferService.getTripOfferById(id);
      if (!trip) {
        return res.status(404).json({
          code: 'not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }

      if (trip.driverId !== userId) {
        return res.status(403).json({
          code: 'forbidden',
          message: 'You do not have permission to view bookings for this trip',
          correlationId: req.correlationId
        });
      }

      // Get bookings from repository with populated passenger data
      const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
      const BookingRequestResponseDto = require('../../domain/dtos/BookingRequestResponseDto');
      const bookingRepo = new MongoBookingRequestRepository();
      
      const BookingRequestModel = require('../../infrastructure/database/models/BookingRequestModel');
      const docs = await BookingRequestModel.find({ tripId: id })
        .populate('passengerId', 'firstName lastName corporateEmail')
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        items: docs.map(doc => BookingRequestResponseDto.fromDocument(doc)),
        total: docs.length
      });
    } catch (error) {
      console.error(
        `[TripOfferController] Get bookings failed | tripId: ${req.params.id} | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      next(error);
    }
  }

  async acceptBooking(req, res, next) {
    try {
      const { tripId, bookingId } = req.params;
      const userId = req.user.id;

      console.log(
        `[TripOfferController] Accept booking | tripId: ${tripId} | bookingId: ${bookingId} | userId: ${userId} | correlationId: ${req.correlationId}`
      );

      // Verify trip ownership
      const trip = await this.tripOfferService.getTripOfferById(tripId);
      if (!trip) {
        return res.status(404).json({
          code: 'not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }

      if (trip.driverId !== userId) {
        return res.status(403).json({
          code: 'forbidden',
          message: 'You do not have permission to manage bookings for this trip',
          correlationId: req.correlationId
        });
      }

      // Accept booking
      const BookingRequestService = require('../../domain/services/BookingRequestService');
      const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
      const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
      const MongoSeatLedgerRepository = require('../../infrastructure/repositories/MongoSeatLedgerRepository');
      
      const bookingRepo = new MongoBookingRequestRepository();
      const tripRepo = new MongoTripOfferRepository();
      const seatLedgerRepo = new MongoSeatLedgerRepository();
      
      const bookingService = new BookingRequestService(bookingRepo, tripRepo);
      
      const updatedBooking = await bookingService.acceptBookingRequest(bookingId, userId, seatLedgerRepo);

      const BookingRequestResponseDto = require('../../domain/dtos/BookingRequestResponseDto');
      res.status(200).json(BookingRequestResponseDto.fromDomain(updatedBooking));
    } catch (error) {
      console.error(
        `[TripOfferController] Accept booking failed | tripId: ${req.params.tripId} | bookingId: ${req.params.bookingId} | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      
      if (error.code === 'booking_not_found') {
        return res.status(404).json({
          code: 'not_found',
          message: 'Booking not found',
          correlationId: req.correlationId
        });
      }

      if (error.code === 'invalid_booking_state') {
        return res.status(409).json({
          code: 'invalid_state',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  async declineBooking(req, res, next) {
    try {
      const { tripId, bookingId } = req.params;
      const userId = req.user.id;
      const { reason } = req.body || {};

      console.log(
        `[TripOfferController] Decline booking | tripId: ${tripId} | bookingId: ${bookingId} | userId: ${userId} | correlationId: ${req.correlationId}`
      );

      // Verify trip ownership
      const trip = await this.tripOfferService.getTripOfferById(tripId);
      if (!trip) {
        return res.status(404).json({
          code: 'not_found',
          message: 'Trip offer not found',
          correlationId: req.correlationId
        });
      }

      if (trip.driverId !== userId) {
        return res.status(403).json({
          code: 'forbidden',
          message: 'You do not have permission to manage bookings for this trip',
          correlationId: req.correlationId
        });
      }

      // Decline booking
      const BookingRequestService = require('../../domain/services/BookingRequestService');
      const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
      const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
      
      const bookingRepo = new MongoBookingRequestRepository();
      const tripRepo = new MongoTripOfferRepository();
      
      const bookingService = new BookingRequestService(bookingRepo, tripRepo);
      
      const updatedBooking = await bookingService.declineBookingRequest(bookingId, userId, reason);

      const BookingRequestResponseDto = require('../../domain/dtos/BookingRequestResponseDto');
      res.status(200).json(BookingRequestResponseDto.fromDomain(updatedBooking));
    } catch (error) {
      console.error(
        `[TripOfferController] Decline booking failed | tripId: ${req.params.tripId} | bookingId: ${req.params.bookingId} | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      
      if (error.code === 'booking_not_found') {
        return res.status(404).json({
          code: 'not_found',
          message: 'Booking not found',
          correlationId: req.correlationId
        });
      }

      if (error.code === 'invalid_booking_state') {
        return res.status(409).json({
          code: 'invalid_state',
          message: error.message,
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }
}

module.exports = TripOfferController;

