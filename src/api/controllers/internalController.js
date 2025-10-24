/**
 * InternalController
 * 
 * Admin-only endpoints for system operations:
 * - Manual job triggers for QA/testing
 * - System health checks
 * - Maintenance tasks
 * 
 * All endpoints require ADMIN role and JWT authentication.
 */

const LifecycleJobService = require('../../domain/services/LifecycleJobService');
const LifecycleJobResultDto = require('../../domain/dtos/LifecycleJobResultDto');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const MongoVehicleRepository = require('../../infrastructure/repositories/MongoVehicleRepository');
const MongoUserRepository = require('../../infrastructure/repositories/MongoUserRepository');

class InternalController {
  constructor() {
    // Initialize repositories
    this.tripOfferRepository = new MongoTripOfferRepository();
    this.bookingRequestRepository = new MongoBookingRequestRepository();
    this.vehicleRepository = new MongoVehicleRepository();
    this.userRepository = new MongoUserRepository();

    // Initialize lifecycle job service
    this.lifecycleJobService = new LifecycleJobService(
      this.tripOfferRepository,
      this.bookingRequestRepository,
      this.vehicleRepository,
      this.userRepository
    );
  }

  /**
   * POST /internal/jobs/run?name=complete-trips
   * 
   * Manually trigger lifecycle jobs (US-3.4.4)
   * 
   * Admin-only endpoint for:
   * - QA/testing
   * - Manual intervention
   * - Immediate cleanup
   * 
   * Jobs:
   * - complete-trips: Auto-complete trips + expire pending bookings
   * - auto-complete-trips: Only complete trips
   * - expire-pendings: Only expire bookings
   * 
   * Query params:
   * - name: Job name (required)
   * - pendingTtlHours: TTL for pending bookings (optional, default: 48)
   * 
   * Response:
   * - 200: Job executed with metrics
   * - 400: Invalid job name
   * - 403: Not admin
   */
  async runLifecycleJob(req, res, next) {
    try {
      const { name = 'complete-trips', pendingTtlHours = 48 } = req.query;
      const adminId = req.user.sub;

      console.log(
        `[InternalController] Manual job trigger | name: ${name} | adminId: ${adminId} | pendingTtlHours: ${pendingTtlHours} | correlationId: ${req.correlationId}`
      );

      let result;

      switch (name) {
        case 'complete-trips':
          // Run both auto-complete and expire jobs
          result = await this.lifecycleJobService.runCompleteTripsJob({
            pendingTtlHours: parseInt(pendingTtlHours, 10)
          });
          break;

        case 'auto-complete-trips':
          // Only auto-complete trips
          result = await this.lifecycleJobService.runAutoCompleteTripsOnly();
          break;

        case 'expire-pendings':
          // Only expire pending bookings
          result = await this.lifecycleJobService.runExpirePendingsOnly(
            parseInt(pendingTtlHours, 10)
          );
          break;

        default:
          console.log(
            `[InternalController] Invalid job name | name: ${name} | correlationId: ${req.correlationId}`
          );
          return res.status(400).json({
            code: 'invalid_job_name',
            message: `Invalid job name: ${name}. Valid names: complete-trips, auto-complete-trips, expire-pendings`,
            correlationId: req.correlationId
          });
      }

      // Map to DTO
      const responseDto = LifecycleJobResultDto.fromJobResult(result);

      console.log(
        `[InternalController] Job completed | name: ${name} | completedTrips: ${result.completedTrips} | expiredPendings: ${result.expiredPendings} | correlationId: ${req.correlationId}`
      );

      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[InternalController] Job execution failed | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      next(error);
    }
  }
}

module.exports = new InternalController();
