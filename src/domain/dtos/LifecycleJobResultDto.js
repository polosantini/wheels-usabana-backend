/**
 * LifecycleJobResultDto
 * 
 * Data Transfer Object for lifecycle job execution results.
 * Provides metrics for monitoring and admin visibility.
 * 
 * Used in: POST /internal/jobs/run (US-3.4.4)
 */

class LifecycleJobResultDto {
  constructor({ ok, completedTrips, expiredPendings }) {
    this.ok = ok;
    this.completedTrips = completedTrips || 0;
    this.expiredPendings = expiredPendings || 0;
  }

  /**
   * Create DTO from job execution result
   * 
   * @param {Object} jobResult - Result from LifecycleJobService
   * @param {boolean} jobResult.ok - Whether job succeeded
   * @param {number} jobResult.completedTrips - Count of trips marked as completed
   * @param {number} jobResult.expiredPendings - Count of bookings marked as expired
   * @returns {LifecycleJobResultDto}
   */
  static fromJobResult(jobResult) {
    return new LifecycleJobResultDto({
      ok: jobResult.ok,
      completedTrips: jobResult.completedTrips,
      expiredPendings: jobResult.expiredPendings
    });
  }
}

module.exports = LifecycleJobResultDto;
