/**
 * DriverController
 * 
 * Driver-specific endpoints for trip and booking management.
 * All endpoints require JWT authentication and driver role.
 */

const BookingRequestService = require('../../domain/services/BookingRequestService');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const MongoSeatLedgerRepository = require('../../infrastructure/repositories/MongoSeatLedgerRepository');

// Initialize services
const bookingRequestRepository = new MongoBookingRequestRepository();
const tripOfferRepository = new MongoTripOfferRepository();
const seatLedgerRepository = new MongoSeatLedgerRepository();
const bookingRequestService = new BookingRequestService(
  bookingRequestRepository,
  tripOfferRepository
);
const DriverVerification = require('../../infrastructure/database/models/DriverVerificationModel');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verificationUpload } = require('../middlewares/uploadMiddleware');

class DriverController {
  /**
   * GET /drivers/trips/:tripId/capacity
   * 
   * Returns a capacity snapshot for a driver's trip.
   * Owner-only. No CSRF required (read-only).
   * 
   * Response: { totalSeats, allocatedSeats, remainingSeats }
   */
  async getTripCapacitySnapshot(req, res, next) {
    try {
      const { tripId } = req.params;
      const driverId = req.user.id;

      console.log(
        `[DriverController] Capacity snapshot | tripId: ${tripId} | driverId: ${driverId}`
      );

      // 1) Load trip
      const trip = await tripOfferRepository.findById(tripId);
      if (!trip) {
        const DomainError = require('../../domain/errors/DomainError');
        return next(new DomainError('Trip offer not found', 'trip_not_found', 404));
      }

      // 2) Ownership check
      if (trip.driverId !== driverId) {
        const DomainError = require('../../domain/errors/DomainError');
        return next(new DomainError('Trip does not belong to the driver', 'forbidden_owner', 403));
      }

      // 3) Get current ledger (may be null if no allocations yet)
      const ledger = await seatLedgerRepository.getLedgerByTripId(tripId);
      const allocatedSeats = ledger ? ledger.allocatedSeats : 0;
      const totalSeats = trip.totalSeats;
      const remainingSeats = Math.max(0, totalSeats - allocatedSeats);

      return res.status(200).json({ totalSeats, allocatedSeats, remainingSeats });
    } catch (err) {
      return next(err);
    }
  }
  /**
   * POST /drivers/booking-requests/:bookingId/decline
   * 
   * Decline a pending booking request.
   * Idempotent: if already declined, returns 200 with declined status.
   * Enforces ownership; no seat ledger changes required.
   */
  async declineBookingRequest(req, res, next) {
    try {
      const { bookingId } = req.params;
      const driverId = req.user.id;

      console.log(
        `[DriverController] Declining booking request | bookingId: ${bookingId} | driverId: ${driverId}`
      );

      const booking = await bookingRequestService.declineBookingRequest(
        bookingId,
        driverId
      );

      // Map to integration contract response
      return res.status(200).json({
        id: booking.id,
        tripId: booking.tripId,
        passengerId: booking.passengerId,
        status: booking.status,
        decidedAt: booking.declinedAt
      });
    } catch (err) {
      if (err && err.code) {
        const DomainError = require('../../domain/errors/DomainError');
        switch (err.code) {
          case 'forbidden_owner':
            return next(new DomainError('Trip does not belong to the driver', 'forbidden_owner', 403));
          case 'invalid_state':
            return next(new DomainError('Booking request cannot be declined in its current state', 'invalid_state', 409));
          case 'booking_not_found':
            return next(new DomainError('Booking request not found', 'booking_not_found', 404));
          case 'trip_not_found':
            return next(new DomainError('Trip offer not found', 'trip_not_found', 404));
          default:
            break; // fall through
        }
      }
      return next(err);
    }
  }
  /**
   * POST /drivers/booking-requests/:bookingId/accept
   * 
   * Accept a pending booking request with atomic seat allocation.
   * Enforces ownership, trip state, and capacity via Seat Ledger.
   */
  async acceptBookingRequest(req, res, next) {
    try {
      const { bookingId } = req.params;
      const driverId = req.user.id;

      console.log(
        `[DriverController] Accepting booking request | bookingId: ${bookingId} | driverId: ${driverId}`
      );

      const booking = await bookingRequestService.acceptBookingRequest(
        bookingId,
        driverId
      );

      // Map to integration contract response
      return res.status(200).json({
        id: booking.id,
        tripId: booking.tripId,
        passengerId: booking.passengerId,
        status: booking.status,
        decidedAt: booking.acceptedAt
      });
    } catch (err) {
      // Map domain error codes to expected HTTP status and codes
      if (err && err.code) {
        const DomainError = require('../../domain/errors/DomainError');
        switch (err.code) {
          case 'forbidden_owner':
            return next(new DomainError('Trip does not belong to the driver', 'forbidden_owner', 403));
          case 'capacity_exceeded':
            return next(new DomainError('No seats remaining for this trip', 'capacity_exceeded', 409));
          case 'invalid_state':
            return next(new DomainError('Booking request cannot be accepted in its current state', 'invalid_state', 409));
          case 'trip_not_published':
          case 'trip_in_past':
            return next(new DomainError('Trip cannot accept new bookings', 'invalid_trip_state', 409));
          case 'booking_not_found':
            return next(new DomainError('Booking request not found', 'booking_not_found', 404));
          case 'trip_not_found':
            return next(new DomainError('Trip offer not found', 'trip_not_found', 404));
          default:
            break; // fall through to global handler
        }
      }
      return next(err);
    }
  }
  /**
   * GET /drivers/trips/:tripId/booking-requests
   * 
   * List booking requests for a specific trip owned by the driver.
   * Supports filtering by status and pagination.
   * 
   * Query params:
   * - status: string|string[] (optional) - Filter by status (pending, accepted, declined, canceled_by_passenger, expired)
   * - page: number (optional, default: 1) - Page number
   * - pageSize: number (optional, default: 10, max: 50) - Results per page
   * 
   * Returns:
   * - 200: Paginated booking requests
   * - 400: Invalid query parameters
   * - 403: Trip not owned by driver
   * - 404: Trip not found
   */
  async listTripBookingRequests(req, res, next) {
    try {
      const { tripId } = req.params;
      const driverId = req.user.id;
      const { status, page, pageSize } = req.query;

      console.log(
        `[DriverController] Listing booking requests for trip | tripId: ${tripId} | driverId: ${driverId} | status: ${status} | page: ${page} | pageSize: ${pageSize}`
      );

      const result = await bookingRequestService.getBookingRequestsForTrip(
        tripId,
        driverId,
        {
          status,
          page: parseInt(page) || 1,
          pageSize: parseInt(pageSize) || 10
        }
      );

      // Map to API response format
      const items = result.bookings.map((booking) => ({
        id: booking.id,
        tripId: booking.tripId,
        passengerId: booking.passengerId,
        status: booking.status,
        seats: booking.seats,
        note: booking.note,
        acceptedAt: booking.acceptedAt,
        declinedAt: booking.declinedAt,
        canceledAt: booking.canceledAt,
        createdAt: booking.createdAt
      }));

      const response = {
        items,
        page: result.page,
        pageSize: result.limit,
        total: result.total,
        totalPages: result.totalPages
      };

      console.log(
        `[DriverController] Booking requests listed | tripId: ${tripId} | total: ${result.total} | page: ${result.page}`
      );

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /drivers/verification
   * Driver submits verification documents (multipart/form-data)
   */
  async submitVerification(req, res, next) {
    try {
      // This method is intended to be used after multer processed files.
      const userId = req.user.sub || req.user.id;
      const correlationId = req.correlationId;

      // Required form fields
      const {
        fullName,
        documentNumber,
        licenseNumber,
        licenseExpiresAt,
        soatNumber,
        soatExpiresAt
      } = req.body || {};

      // Files: provided by multer as req.files
      const files = req.files || {};

      // Validate required fields and files
      if (!fullName || !documentNumber || !licenseNumber || !licenseExpiresAt || !soatNumber || !soatExpiresAt) {
        return res.status(400).json({ code: 'invalid_schema', message: 'Missing or invalid fields', correlationId });
      }

      if (!files.govIdFront || !files.driverLicense || !files.soat) {
        return res.status(400).json({ code: 'invalid_schema', message: 'Missing required files', correlationId });
      }

      // Helper to compute sha256 hash of a file
      const fileHash = (filePath) => {
        const buf = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(buf).digest('hex');
      };

      // Build document objects
      const now = new Date();
      const created = {
        govIdFront: {
          storagePath: files.govIdFront[0].path,
          hash: fileHash(files.govIdFront[0].path),
          uploadedAt: now,
          expiresAt: null
        },
        govIdBack: files.govIdBack ? {
          storagePath: files.govIdBack[0].path,
          hash: fileHash(files.govIdBack[0].path),
          uploadedAt: now,
          expiresAt: null
        } : undefined,
        driverLicense: {
          storagePath: files.driverLicense[0].path,
          hash: fileHash(files.driverLicense[0].path),
          uploadedAt: now,
          expiresAt: new Date(licenseExpiresAt)
        },
        soat: {
          storagePath: files.soat[0].path,
          hash: fileHash(files.soat[0].path),
          uploadedAt: now,
          expiresAt: new Date(soatExpiresAt)
        }
      };

      // Prepare hashed identifiers for numbers (store hashed to avoid PII)
      const documentNumberHash = crypto.createHash('sha256').update(String(documentNumber)).digest('hex');
      const licenseNumberHash = crypto.createHash('sha256').update(String(licenseNumber)).digest('hex');
      const soatNumberHash = crypto.createHash('sha256').update(String(soatNumber)).digest('hex');

      // Upsert DriverVerification record (idempotent re-submission replaces docs)
      let existing = await DriverVerification.findOne({ userId });

      // If existing, optionally delete old stored files (best-effort)
      try {
        if (existing && existing.documents) {
          const oldPaths = [];
          ['govIdFront','govIdBack','driverLicense','soat'].forEach(k => {
            if (existing.documents[k] && existing.documents[k].storagePath) oldPaths.push(existing.documents[k].storagePath);
          });
          oldPaths.forEach(p => {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e) { console.warn('Could not remove old verification file', e.message); }
          });
        }
      } catch (e) {
        // ignore cleanup errors
      }

      const saveDoc = {
        userId,
        status: 'pending_review',
        fullName,
        documentNumberHash,
        documents: {
          govIdFront: created.govIdFront,
          govIdBack: created.govIdBack,
          driverLicense: created.driverLicense,
          soat: created.soat
        },
        licenseNumberHash,
        soatNumberHash,
        submittedAt: now,
        lastUpdatedAt: now
      };

      // Persist
      let upserted = null;
      try {
        upserted = await DriverVerification.findOneAndUpdate({ userId }, saveDoc, { upsert: true, new: true, setDefaultsOnInsert: true });
      } catch (err) {
        // Rollback uploaded files on DB failure
        const newPaths = [];
        Object.values(files).forEach(arr => { if (Array.isArray(arr)) newPaths.push(arr[0].path); });
        newPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e){} });
        console.error('[DriverController] Failed to persist verification profile:', err.message);
        return res.status(500).json({ code: 'internal_error', message: 'Failed to save verification', correlationId });
      }

      // Response: minimal non-PII profile per contract (note: documentNumber included as example)
      const resp = {
        status: upserted.status,
        submittedAt: upserted.submittedAt,
        profile: {
          fullName: upserted.fullName,
          documentNumber: documentNumber,
          license: { number: licenseNumber, expiresAt: upserted.documents.driverLicense.expiresAt },
          soat: { number: soatNumber, expiresAt: upserted.documents.soat.expiresAt }
        }
      };

      return res.status(201).json(resp);
    } catch (err) {
      // Cleanup any uploaded files on unexpected error
      try {
        const files = req.files || {};
        Object.values(files).forEach(arr => { if (Array.isArray(arr) && arr[0] && arr[0].path) {
          try { fs.unlinkSync(arr[0].path); } catch(e){}
        }});
      } catch (e) {}
      console.error('[DriverController] submitVerification error:', err);
      next(err);
    }
  }

  /**
   * GET /drivers/verification
   * Owner-only read of current verification profile (non-PII)
   */
  async getMyVerification(req, res, next) {
    try {
      const userId = req.user.sub || req.user.id;
      const correlationId = req.correlationId;

      const profile = await DriverVerification.findOne({ userId }).lean();
      if (!profile) {
        return res.status(404).json({ code: 'not_found', message: 'No verification profile yet', correlationId });
      }

      // Build documents summary without exposing storage paths or raw filenames
      const docs = [];
      const docKeys = [ 'govIdFront', 'govIdBack', 'driverLicense', 'soat' ];
      docKeys.forEach((k) => {
        const d = profile.documents && profile.documents[k];
        if (d && d.uploadedAt) {
          const ext = d.storagePath ? require('path').extname(d.storagePath) : '';
          // Masked name: use type + ext (no original filename)
          const maskedName = `${k}${ext}`;
          docs.push({ type: k, uploadedAt: d.uploadedAt, name: maskedName });
        }
      });

      const review = (profile.adminNotes && profile.adminNotes.length > 0) ? profile.adminNotes[profile.adminNotes.length - 1] : null;

      return res.status(200).json({ status: profile.status, submittedAt: profile.submittedAt, documents: docs, review });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /drivers/trips/:tripId
   * 
   * Cancel a trip with cascade to all bookings (US-3.4.2).
   * 
   * Owner-only endpoint. Atomically:
   * 1. Cancel trip (published|draft → canceled)
   * 2. Decline all pending bookings (→ declined_auto)
   * 3. Cancel all accepted bookings (→ canceled_by_platform)
   * 4. Deallocate seats from ledger
   * 5. Set refundNeeded flag for paid accepted bookings
   * 
   * Returns effects summary with counts.
   * 
   * Response:
   * - 200: Trip canceled with effects summary
   * - 403: forbidden_owner (trip not owned by driver)
   * - 404: trip_not_found
   * - 409: invalid_transition (trip already canceled or completed)
   */
  async cancelTrip(req, res, next) {
    try {
      const { tripId } = req.params;
      const driverId = req.user.id;

      console.log(
        `[DriverController] Canceling trip with cascade | tripId: ${tripId} | driverId: ${driverId}`
      );

      // Initialize TripOfferService with repositories
      const TripOfferService = require('../../domain/services/TripOfferService');
      const MongoVehicleRepository = require('../../infrastructure/repositories/MongoVehicleRepository');
      const MongoUserRepository = require('../../infrastructure/repositories/MongoUserRepository');

      const vehicleRepository = new MongoVehicleRepository();
      const userRepository = new MongoUserRepository();
      const tripOfferService = new TripOfferService(
        tripOfferRepository,
        vehicleRepository,
        userRepository
      );

      // Call cascade cancellation service
      const result = await tripOfferService.cancelTripWithCascade(
        tripId,
        driverId,
        bookingRequestRepository,
        seatLedgerRepository
      );

      console.log(
        `[DriverController] Trip canceled successfully | tripId: ${tripId} | effects: ${JSON.stringify(result.effects)}`
      );

      // Map to integration contract response
      const TripCancellationResultDto = require('../../domain/dtos/TripCancellationResultDto');
      const responseDto = TripCancellationResultDto.fromCancellationResult(
        result.tripId,
        result.status,
        result.effects
      );

      res.status(200).json(responseDto);
    } catch (error) {
      // Map domain errors to expected HTTP status codes
      if (error && error.code) {
        const DomainError = require('../../domain/errors/DomainError');
        const InvalidTransitionError = require('../../domain/errors/InvalidTransitionError');

        switch (error.code) {
          case 'forbidden_owner':
            return next(
              new DomainError('Trip does not belong to the driver', 'forbidden_owner', 403)
            );
          case 'trip_not_found':
            return next(new DomainError('Trip offer not found', 'trip_not_found', 404));
          case 'invalid_transition':
            return next(
              new InvalidTransitionError(
                'Trip is already canceled or completed',
                error.details?.currentState || 'unknown',
                error.details?.attemptedState || 'canceled',
                409
              )
            );
          case 'transaction_failed':
            return next(
              new DomainError('Failed to cancel trip atomically', 'transaction_failed', 500)
            );
          default:
            break; // fall through to global error handler
        }
      }
      next(error);
    }
  }
}

module.exports = new DriverController();

