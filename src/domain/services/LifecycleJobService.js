/**
 * LifecycleJobService
 * 
 * Orchestrates background jobs for maintaining trip and booking lifecycle states.
 * 
 * Jobs:
 * 1. Auto-complete trips: Mark published trips as completed when past arrival time
 * 2. Expire pending bookings: Mark old pending bookings as expired per TTL config
 * 
 * All jobs are idempotent and emit metrics for monitoring.
 */

const TripOfferService = require('./TripOfferService');
const BookingRequestService = require('./BookingRequestService');

class LifecycleJobService {
  constructor(tripOfferRepository, bookingRequestRepository, vehicleRepository, userRepository) {
    // Initialize dependent services
    this.tripOfferService = new TripOfferService(
      tripOfferRepository,
      vehicleRepository,
      userRepository
    );
    
    this.bookingRequestService = new BookingRequestService(
      bookingRequestRepository,
      tripOfferRepository
    );
  }

  /**
   * Run complete-trips job (US-3.4.4)
   * 
   * Orchestrates:
   * 1. Auto-complete eligible trips (published → completed)
   * 2. Expire old pending bookings (pending → expired)
   * 
   * Idempotent: Can be safely run multiple times.
   * 
   * @param {Object} options - Job options
   * @param {number} options.pendingTtlHours - TTL for pending bookings (default: 48 hours)
   * @returns {Promise<Object>} Job result with metrics { ok: true, completedTrips, expiredPendings }
   */
  async runCompleteTripsJob(options = {}) {
    const { pendingTtlHours = 48 } = options;

    console.log(
      `[LifecycleJobService] Starting complete-trips job | pendingTtlHours: ${pendingTtlHours}`
    );

    const startTime = Date.now();

    try {
      // Run both jobs in parallel for efficiency
      const [completedTrips, expiredPendings] = await Promise.all([
        this.tripOfferService.autoCompleteTrips(),
        this.bookingRequestService.expirePendingBookings(pendingTtlHours)
      ]);

      const duration = Date.now() - startTime;

      console.log(
        `[LifecycleJobService] complete-trips job completed | completedTrips: ${completedTrips} | expiredPendings: ${expiredPendings} | duration: ${duration}ms`
      );

      return {
        ok: true,
        completedTrips,
        expiredPendings,
        durationMs: duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(
        `[LifecycleJobService] complete-trips job failed | error: ${error.message} | duration: ${duration}ms`
      );

      throw error;
    }
  }

  /**
   * Run auto-complete trips job only
   * @returns {Promise<Object>} { ok: true, completedTrips }
   */
  async runAutoCompleteTripsOnly() {
    console.log('[LifecycleJobService] Starting auto-complete trips only');

    const completedTrips = await this.tripOfferService.autoCompleteTrips();

    return {
      ok: true,
      completedTrips,
      expiredPendings: 0
    };
  }

  /**
   * Run expire pending bookings job only
   * @param {number} ttlHours - TTL in hours
   * @returns {Promise<Object>} { ok: true, expiredPendings }
   */
  async runExpirePendingsOnly(ttlHours = 48) {
    console.log(`[LifecycleJobService] Starting expire pendings only | TTL: ${ttlHours}h`);

    const expiredPendings = await this.bookingRequestService.expirePendingBookings(ttlHours);

    return {
      ok: true,
      completedTrips: 0,
      expiredPendings
    };
  }
}

module.exports = LifecycleJobService;
