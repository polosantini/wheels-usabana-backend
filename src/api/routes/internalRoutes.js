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
const { renderTemplateBodySchema, dispatchNotificationBodySchema } = require('../validation/internalSchemas');
const { validateTemplateBodySchema } = require('../validation/internalSchemas');
const templateRegistry = require('../../domain/services/templateRegistry');

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
  internalController.runLifecycleJob.bind(internalController)
);

/**
 * @route POST /internal/notifications/templates/render
 * @desc  Preview notification templates (admin-only, read-only)
 * Body: { channel, type, variables }
 */
router.post(
  '/notifications/templates/render',
  authenticate,
  requireRole('admin'),
  validateRequest(renderTemplateBodySchema, 'body'),
  internalController.renderTemplate.bind(internalController)
);

/**
 * GET /internal/notifications/templates/registry
 * Admin-only: list template metadata
 */
router.get(
  '/notifications/templates/registry',
  authenticate,
  requireRole('admin'),
  (req, res) => {
    const items = templateRegistry.listMetadata();
    res.status(200).json({ items });
  }
);

/**
 * POST /internal/notifications/templates/validate
 * Admin-only: validate a draft template payload (no side-effects)
 */
router.post(
  '/notifications/templates/validate',
  authenticate,
  requireRole('admin'),
  validateRequest(validateTemplateBodySchema, 'body'),
  internalController.validateTemplate.bind(internalController)
);

/**
 * GET /admin/notifications/metrics
 * Admin-only: aggregated delivery metrics per type/channel/date range
 */
router.get(
  '/admin/notifications/metrics',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    const { from, to } = req.query;
    const metricsService = require('../../domain/services/notificationMetrics');
    try {
      const result = await metricsService.queryRange(from || new Date(), to || new Date());
      res.status(200).json(result);
    } catch (err) {
      console.error('[InternalRoutes] metrics query failed', err);
      res.status(500).json({ code: 'server_error', message: 'Metrics query failed' });
    }
  }
);

router.post(
  '/notifications/dispatch',
  authenticate,
  requireRole('admin'),
  requireCsrf,
  validateRequest(dispatchNotificationBodySchema, 'body'),
  internalController.dispatchNotification.bind(internalController)
);

// Admin: generate short-lived preview URL for driver document (admin-only)
router.get(
  '/admin/drivers/:driverId/verification/documents/:docType/url',
  authenticate,
  requireRole('admin'),
  internalController.generateDocumentPreviewUrl.bind(internalController)
);

// Public preview endpoint: serves single-use token-protected documents (no auth)
router.get('/previews/:token', internalController.servePreviewByToken.bind(internalController));

/**
 * PATCH /admin/drivers/:driverId/verification
 * Admin review endpoint: approve | reject
 */
const { reviewDriverVerificationBodySchema } = require('../validation/internalSchemas');
router.patch(
  '/admin/drivers/:driverId/verification',
  authenticate,
  requireRole('admin'),
  requireCsrf,
  validateRequest(reviewDriverVerificationBodySchema, 'body'),
  internalController.reviewDriverVerification.bind(internalController)
);

// Admin review moderation: hide/unhide reviews
const ReviewController = require('../controllers/reviewController');
const reviewController = new ReviewController();
const { reviewIdParamSchema } = require('../validation/reviewSchemas');

router.patch(
  '/admin/reviews/:reviewId/hide',
  authenticate,
  requireRole('admin'),
  requireCsrf,
  validateRequest(reviewIdParamSchema, 'params'),
  reviewController.adminHideReview.bind(reviewController)
);

router.patch(
  '/admin/reviews/:reviewId/unhide',
  authenticate,
  requireRole('admin'),
  requireCsrf,
  validateRequest(reviewIdParamSchema, 'params'),
  reviewController.adminUnhideReview.bind(reviewController)
);

// Admin batch endpoint: set visibility with reason
router.patch(
  '/admin/reviews/:reviewId/visibility',
  authenticate,
  requireRole('admin'),
  requireCsrf,
  validateRequest(reviewIdParamSchema, 'params'),
  validateRequest(require('../validation/reviewSchemas').adminVisibilityBodySchema, 'body'),
  reviewController.adminSetVisibility.bind(reviewController)
);

module.exports = router;
