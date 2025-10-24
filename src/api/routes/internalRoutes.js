/**
 * Internal Routes
 * 
 * Admin-only endpoints for system operations:
 * - Manual job triggers for QA/testing
 * - System health checks
 * - Maintenance tasks
 * 
 * All routes require JWT authentication and ADMIN role.
 */

const express = require('express');
const router = express.Router();

const internalController = require('../controllers/internalController');
const authenticate = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/authenticate');
const requireCsrf = require('../middlewares/requireCsrf');
const validateRequest = require('../middlewares/validateRequest');
const { runJobQuerySchema } = require('../validation/internalSchemas');

/**
 * @route   POST /internal/jobs/run
 * @desc    Manually trigger lifecycle jobs (US-3.4.4)
 * @access  Private (Admin only)
 * @query   {string} name - Job name (complete-trips, auto-complete-trips, expire-pendings)
 * @query   {number} pendingTtlHours - TTL for pending bookings (default: 48, max: 168)
 */
/**
 * @openapi
 * /internal/jobs/run:
 *   post:
 *     tags:
 *       - Internal
 *     summary: Run lifecycle jobs manually (Admin only)
 *     description: |
 *       Manually trigger background jobs for trip/booking lifecycle management.
 *       
 *       **Admin-only**: Requires JWT cookie with role='admin'.
 *       **CSRF Protection**: Required for state-changing operations.
 *       
 *       **Available Jobs**:
 *       - `complete-trips`: Auto-complete trips + expire pending bookings (default)
 *       - `auto-complete-trips`: Only complete trips past arrival time
 *       - `expire-pendings`: Only expire old pending bookings
 *       
 *       **Use Cases**:
 *       - QA/testing
 *       - Manual intervention
 *       - Immediate cleanup after config changes
 *       
 *       **Idempotent**: Safe to run multiple times.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: name
 *         required: false
 *         schema:
 *           type: string
 *           enum: [complete-trips, auto-complete-trips, expire-pendings]
 *           default: complete-trips
 *         description: Job name to execute
 *       - in: query
 *         name: pendingTtlHours
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 168
 *           default: 48
 *         description: TTL for pending bookings in hours (max 7 days)
 *     responses:
 *       200:
 *         description: Job executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 completedTrips:
 *                   type: integer
 *                   description: Count of trips marked as completed
 *                   example: 12
 *                 expiredPendings:
 *                   type: integer
 *                   description: Count of bookings marked as expired
 *                   example: 7
 *             examples:
 *               complete_trips:
 *                 summary: Both jobs executed
 *                 value:
 *                   ok: true
 *                   completedTrips: 12
 *                   expiredPendings: 7
 *               auto_complete_only:
 *                 summary: Only trips completed
 *                 value:
 *                   ok: true
 *                   completedTrips: 5
 *                   expiredPendings: 0
 *       400:
 *         description: Invalid job name or parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: invalid_job_name
 *                 message:
 *                   type: string
 *                   example: "Invalid job name: foo. Valid names: complete-trips, auto-complete-trips, expire-pendings"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Not admin role
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: forbidden_role
 *                 message:
 *                   type: string
 *                   example: Admin role required
 */
router.post(
  '/jobs/run',
  authenticate,
  requireRole('admin'),
  requireCsrf,
  validateRequest(runJobQuerySchema, 'query'),
  internalController.runLifecycleJob
);

module.exports = router;
