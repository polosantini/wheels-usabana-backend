/**
 * BookingRequestController
 * 
 * Handles passenger booking request operations.
 * Enforces RBAC (passenger-only) and business rules.
 */

const BookingRequestService = require('../../domain/services/BookingRequestService');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const CreateBookingRequestDto = require('../../domain/dtos/CreateBookingRequestDto');
const BookingRequestResponseDto = require('../../domain/dtos/BookingRequestResponseDto');
const DomainError = require('../../domain/errors/DomainError');

class BookingRequestController {
  constructor() {
    this.bookingRequestRepository = new MongoBookingRequestRepository();
    this.tripOfferRepository = new MongoTripOfferRepository();
    this.bookingRequestService = new BookingRequestService(
      this.bookingRequestRepository,
      this.tripOfferRepository
    );
  }

  /**
   * POST /passengers/bookings
   * Create a new booking request (passenger only)
   */
  async createBookingRequest(req, res, next) {
    try {
      const passengerId = req.user.sub;

      console.log(
        `[BookingRequestController] Create booking request | passengerId: ${passengerId} | correlationId: ${req.correlationId}`
      );

      // Create DTO from request body
      const createDto = CreateBookingRequestDto.fromRequest(req.body);

      // Create booking request via service (includes all invariant checks)
      const bookingRequest = await this.bookingRequestService.createBookingRequest(
        createDto,
        passengerId
      );

      const responseDto = BookingRequestResponseDto.fromDomain(bookingRequest);

      console.log(
        `[BookingRequestController] Booking request created | requestId: ${bookingRequest.id} | tripId: ${bookingRequest.tripId} | correlationId: ${req.correlationId}`
      );

      res.status(201).json(responseDto);
    } catch (error) {
      console.error(
        `[BookingRequestController] Create failed | passengerId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      // Map domain errors to HTTP responses
      if (error instanceof DomainError) {
        switch (error.code) {
          case 'trip_not_found':
            return res.status(404).json({
              code: 'trip_not_found',
              message: error.message,
              correlationId: req.correlationId
            });

          case 'invalid_trip_state':
            return res.status(409).json({
              code: 'invalid_trip_state',
              message: error.message,
              correlationId: req.correlationId
            });

          case 'duplicate_request':
            return res.status(409).json({
              code: 'duplicate_request',
              message: error.message,
              correlationId: req.correlationId
            });

          case 'cannot_book_own_trip':
            return res.status(403).json({
              code: 'cannot_book_own_trip',
              message: error.message,
              correlationId: req.correlationId
            });

          default:
            return res.status(400).json({
              code: 'bad_request',
              message: error.message,
              correlationId: req.correlationId
            });
        }
      }

      // Handle validation errors
      if (error.name === 'ValidationError' || error.code === 'invalid_schema') {
        return res.status(400).json({
          code: 'invalid_schema',
          message: error.message,
          details: error.details || [],
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  /**
   * GET /passengers/bookings
   * List caller's booking requests with filters and pagination
   */
  async listMyBookingRequests(req, res, next) {
    try {
      const passengerId = req.user.sub;

      console.log(
        `[BookingRequestController] List booking requests | passengerId: ${passengerId} | correlationId: ${req.correlationId}`
      );

      // Extract query parameters
      const { status, fromDate, toDate, page = 1, pageSize = 10 } = req.query;

      // Build filters
      const filters = {};
      
      if (status) {
        // Handle both single string and array of strings
        filters.status = Array.isArray(status) ? status : [status];
      }

      if (fromDate) {
        filters.fromDate = new Date(fromDate);
      }

      if (toDate) {
        filters.toDate = new Date(toDate);
      }

      // Add pagination to filters (use 'limit' as expected by repository)
      filters.page = parseInt(page, 10);
      filters.limit = parseInt(pageSize, 10);

      // List booking requests via service (with populated trip data)
      const result = await this.bookingRequestService.listBookingRequestsWithTrip(
        passengerId,
        filters
      );

      // Convert to DTOs (repository returns Mongoose docs with populated tripId)
      const items = result.bookings.map(booking => BookingRequestResponseDto.fromDocument(booking));

      console.log(
        `[BookingRequestController] Booking requests listed | passengerId: ${passengerId} | total: ${result.total} | returned: ${items.length} | correlationId: ${req.correlationId}`
      );

      res.status(200).json({
        items,
        page: result.page,
        pageSize: result.limit, // Repository returns 'limit', rename to 'pageSize' for API
        total: result.total,
        totalPages: result.totalPages
      });
    } catch (error) {
      console.error(
        `[BookingRequestController] List failed | passengerId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      // Handle validation errors
      if (error.name === 'ValidationError' || error.code === 'invalid_schema') {
        return res.status(400).json({
          code: 'invalid_schema',
          message: 'Invalid query parameters',
          details: error.details || [],
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }

  /**
   * POST /passengers/bookings/:bookingId/cancel
   * Cancel a booking request with optional reason (US-3.4.3)
   * 
   * Owner-only cancellation. If pending, simple status update. If accepted,
   * runs transaction to decrement seat ledger and set refundNeeded flag.
   * 
   * Returns effects summary with ledgerReleased count and refundCreated boolean.
   */
  async cancelMyBookingRequest(req, res, next) {
    try {
      const { bookingId } = req.params;
      const passengerId = req.user.sub;
      const { reason = '' } = req.body || {};

      console.log(
        `[BookingRequestController] Cancel booking request | bookingId: ${bookingId} | passengerId: ${passengerId} | reason: ${reason ? 'provided' : 'none'} | correlationId: ${req.correlationId}`
      );

      // Initialize seat ledger repository for accepted booking cancellations
      const MongoSeatLedgerRepository = require('../../infrastructure/repositories/MongoSeatLedgerRepository');
      const seatLedgerRepository = new MongoSeatLedgerRepository();

      // Cancel booking request via service (includes ownership and state checks)
      const cancellationResult = await this.bookingRequestService.cancelBookingRequest(
        bookingId,
        passengerId,
        reason,
        seatLedgerRepository
      );

      // Map to integration contract response using DTO
      const BookingCancellationResultDto = require('../../domain/dtos/BookingCancellationResultDto');
      const responseDto = BookingCancellationResultDto.fromCancellationResult(
        cancellationResult.bookingId,
        cancellationResult.status,
        cancellationResult.effects
      );

      console.log(
        `[BookingRequestController] Booking request canceled | bookingId: ${bookingId} | effects: ${JSON.stringify(cancellationResult.effects)} | correlationId: ${req.correlationId}`
      );

      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[BookingRequestController] Cancel failed | bookingId: ${req.params?.bookingId} | passengerId: ${req.user?.sub} | error: ${error.message} | correlationId: ${req.correlationId}`
      );

      // Map domain errors to HTTP responses
      if (error instanceof DomainError || error.code) {
        const errorCode = error.code || 'unknown_error';
        
        switch (errorCode) {
          case 'booking_not_found':
            return res.status(404).json({
              code: 'booking_not_found',
              message: 'Booking request not found',
              correlationId: req.correlationId
            });

          case 'ownership_violation':
          case 'forbidden_owner':
            return res.status(403).json({
              code: 'forbidden_owner',
              message: 'You cannot modify this booking request',
              correlationId: req.correlationId
            });

          case 'invalid_transition':
          case 'invalid_state':
            return res.status(409).json({
              code: 'invalid_state',
              message: 'Request cannot be canceled in its current state',
              correlationId: req.correlationId
            });

          case 'transaction_failed':
            return res.status(500).json({
              code: 'transaction_failed',
              message: 'Failed to cancel booking atomically',
              correlationId: req.correlationId
            });

          default:
            return res.status(400).json({
              code: 'bad_request',
              message: error.message,
              correlationId: req.correlationId
            });
        }
      }

      // Handle validation errors
      if (error.name === 'ValidationError' || error.code === 'invalid_schema') {
        return res.status(400).json({
          code: 'invalid_schema',
          message: error.message,
          details: error.details || [],
          correlationId: req.correlationId
        });
      }

      next(error);
    }
  }
}

module.exports = BookingRequestController;

