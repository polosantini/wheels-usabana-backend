/**
 * Driver Routes
 * 
 * Driver-specific endpoints for trip and booking management.
 * All routes require JWT authentication and driver role.
 */

const express = require('express');
const router = express.Router();

const driverController = require('../controllers/driverController');
const authenticate = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/authenticate');
const requireCsrf = require('../middlewares/requireCsrf');
const validateRequest = require('../middlewares/validateRequest');
const {
  driverTripBookingRequestsQuerySchema,
  tripIdParamSchema,
  bookingIdParamSchema
} = require('../validation/bookingRequestSchemas');

/**
 * @route   GET /drivers/trips/:tripId/booking-requests
 * @desc    List booking requests for a specific trip owned by the driver
 * @access  Private (Driver only)
 * @query   {string|string[]} status - Optional status filter (pending, accepted, declined, canceled_by_passenger, expired)
 * @query   {number} page - Optional page number (default: 1)
 * @query   {number} pageSize - Optional page size (default: 10, max: 50)
 */
/**
 * @openapi
 * /drivers/trips/{tripId}/booking-requests:
 *   get:
 *     tags:
 *       - Trip Offers
 *     summary: List booking requests for my trip (Driver)
 *     description: |
 *       Returns booking requests for a trip owned by the authenticated driver.
 *       Supports filtering by status and pagination.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tripId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *         description: Trip ID (must belong to the authenticated driver)
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [pending, accepted, declined, canceled_by_passenger, expired]
 *             - type: array
 *               items:
 *                 type: string
 *                 enum: [pending, accepted, declined, canceled_by_passenger, expired]
 *         description: Filter by one or more statuses
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *     responses:
 *       200:
 *         description: Booking requests retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, example: "66a1b2c3d4e5f6a7b8c9d0e1" }
 *                       tripId: { type: string, example: "66a1b2c3d4e5f6a7b8c9d0e1" }
 *                       passengerId: { type: string, example: "665e2af1b2c3d4e5f6a7b8c9" }
 *                       status: { type: string, enum: [pending, accepted, declined, canceled_by_passenger, expired], example: "pending" }
 *                       seats: { type: integer, example: 1 }
 *                       note: { type: string, nullable: true, example: "Window seat please" }
 *                       acceptedAt: { type: string, format: date-time, nullable: true }
 *                       declinedAt: { type: string, format: date-time, nullable: true }
 *                       canceledAt: { type: string, format: date-time, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                 page: { type: integer, example: 1 }
 *                 pageSize: { type: integer, example: 10 }
 *                 total: { type: integer, example: 3 }
 *                 totalPages: { type: integer, example: 1 }
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Trip not owned by driver
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: forbidden_owner }
 *                 message: { type: string, example: Trip does not belong to the driver }
 *       404:
 *         description: Trip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: trip_not_found }
 *                 message: { type: string, example: Trip offer not found }
 */
router.get(
  '/trips/:tripId/booking-requests',
  authenticate,
  validateRequest(tripIdParamSchema, 'params'),
  validateRequest(driverTripBookingRequestsQuerySchema, 'query'),
  driverController.listTripBookingRequests
);

/**
 * @openapi
 * /drivers/trips/{tripId}/capacity:
 *   get:
 *     tags:
 *       - Trip Offers
 *     summary: Capacity snapshot for my trip (Driver)
 *     description: |
 *       Returns current capacity numbers for a driver's trip. Owner-only.
 *       Response includes `totalSeats`, `allocatedSeats` (from Seat Ledger), and `remainingSeats`.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tripId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *         description: Trip ID (must belong to the authenticated driver)
 *     responses:
 *       200:
 *         $ref: '#/components/responses/CapacitySnapshot'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         $ref: '#/components/responses/ErrorForbiddenOwner'
 *       404:
 *         description: Trip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: trip_not_found }
 *                 message: { type: string, example: Trip offer not found }
 */
router.get(
  '/trips/:tripId/capacity',
  authenticate,
  requireRole('driver'),
  validateRequest(tripIdParamSchema, 'params'),
  driverController.getTripCapacitySnapshot
);

/**
 * @route   POST /drivers/booking-requests/:bookingId/accept
 * @desc    Accept a pending booking request (atomic seat allocation)
 * @access  Private (Driver only)
 */
/**
 * @openapi
 * /drivers/booking-requests/{bookingId}/accept:
 *   post:
 *     tags:
 *       - Trip Offers
 *     summary: Accept a booking request (Driver)
 *     description: |
 *       Accepts a pending booking request. Seats are allocated atomically.
 *       Requires driver to own the trip. Protected by CSRF (cookie + header) and JWT cookie.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *     responses:
 *       200:
 *         $ref: '#/components/responses/BookingAccepted'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         $ref: '#/components/responses/ErrorForbiddenOwner'
 *       404:
 *         description: Booking or trip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: booking_not_found }
 *                 message: { type: string, example: Booking request not found }
 *       409:
 *         $ref: '#/components/responses/ErrorCapacityOrState'
 */
router.post(
  '/booking-requests/:bookingId/accept',
  authenticate,
  requireRole('driver'),
  requireCsrf,
  validateRequest(bookingIdParamSchema, 'params'),
  driverController.acceptBookingRequest
);

/**
 * @route   POST /drivers/booking-requests/:bookingId/decline
 * @desc    Decline a pending booking request (idempotent)
 * @access  Private (Driver only)
 */
/**
 * @openapi
 * /drivers/booking-requests/{bookingId}/decline:
 *   post:
 *     tags:
 *       - Trip Offers
 *     summary: Decline a booking request (Driver)
 *     description: |
 *       Declines a pending booking request. Operation is idempotent: already declined returns 200.
 *       Requires driver to own the trip. Protected by CSRF (cookie + header) and JWT cookie.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *     responses:
 *       200:
 *         description: Booking declined (or already declined)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string, example: "66a1b2c3d4e5f6a7b8c9d0e1" }
 *                 tripId: { type: string, example: "66a1b2c3d4e5f6a7b8c9d0e1" }
 *                 passengerId: { type: string, example: "665e2af1b2c3d4e5f6a7b8c9" }
 *                 status: { type: string, example: declined }
 *                 decidedAt: { type: string, format: date-time, example: "2025-10-23T05:00:00.000Z" }
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Trip not owned by driver
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: forbidden_owner }
 *                 message: { type: string, example: Trip does not belong to the driver }
 *       404:
 *         description: Booking or trip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: booking_not_found }
 *                 message: { type: string, example: Booking request not found }
 *       409:
 *         description: Conflict - invalid state (e.g., already accepted)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: invalid_state }
 *                 message: { type: string, example: Booking request cannot be declined in its current state }
 */
router.post(
  '/booking-requests/:bookingId/decline',
  authenticate,
  requireRole('driver'),
  requireCsrf,
  validateRequest(bookingIdParamSchema, 'params'),
  driverController.declineBookingRequest
);

/**
 * @route   DELETE /drivers/trips/:tripId
 * @desc    Cancel a trip with cascade to all bookings (US-3.4.2)
 * @access  Private (Driver only, owner-only)
 */
/**
 * @openapi
 * /drivers/trips/{tripId}:
 *   delete:
 *     tags:
 *       - Trip Offers
 *     summary: Cancel trip with cascade (Driver)
 *     description: |
 *       Cancel a trip owned by the authenticated driver.
 *       Atomically performs:
 *       - Cancel trip (published|draft → canceled)
 *       - Decline all pending bookings (→ declined_auto)
 *       - Cancel all accepted bookings (→ canceled_by_platform)
 *       - Deallocate seats from ledger
 *       - Set refundNeeded flag for paid accepted bookings (triggers US-4.2)
 * 
 *       Returns effects summary with counts.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tripId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *         description: Trip ID (must belong to the authenticated driver)
 *     responses:
 *       200:
 *         description: Trip canceled with effects summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "66a1b2c3d4e5f6a7b8c9d0e1"
 *                 status:
 *                   type: string
 *                   enum: [canceled]
 *                   example: "canceled"
 *                 effects:
 *                   type: object
 *                   properties:
 *                     declinedAuto:
 *                       type: integer
 *                       example: 4
 *                       description: Count of pending bookings auto-declined
 *                     canceledByPlatform:
 *                       type: integer
 *                       example: 2
 *                       description: Count of accepted bookings canceled by platform
 *                     refundsCreated:
 *                       type: integer
 *                       example: 2
 *                       description: Count of RefundIntents created (US-4.2)
 *                     ledgerReleased:
 *                       type: integer
 *                       example: 2
 *                       description: Count of seat ledger releases
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Trip not owned by driver
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: forbidden_owner
 *                 message:
 *                   type: string
 *                   example: Trip does not belong to the driver
 *       404:
 *         description: Trip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: trip_not_found
 *                 message:
 *                   type: string
 *                   example: Trip offer not found
 *       409:
 *         description: Invalid state transition (already canceled or completed)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: invalid_transition
 *                 message:
 *                   type: string
 *                   example: Trip is already canceled or completed
 */
router.delete(
  '/trips/:tripId',
  authenticate,
  requireRole('driver'),
  requireCsrf,
  validateRequest(tripIdParamSchema, 'params'),
  driverController.cancelTrip
);

module.exports = router;
