/**
 * Passenger Routes
 * 
 * Routes for passenger-specific operations:
 * - Trip search (published trips only)
 * - Booking requests (future subtasks)
 */

const express = require('express');
const PassengerTripController = require('../controllers/passengerTripController');
const BookingRequestController = require('../controllers/bookingRequestController');
const validateRequest = require('../middlewares/validateRequest');
const { searchTripsQuerySchema } = require('../validation/tripOfferSchemas');
const { 
  createBookingRequestSchema, 
  listBookingRequestsQuerySchema, 
  bookingIdParamSchema,
  cancelBookingRequestSchema 
} = require('../validation/bookingRequestSchemas');
const { generalRateLimiter } = require('../middlewares/rateLimiter');
const authenticate = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/authenticate');
const requireCsrf = require('../middlewares/requireCsrf');

const router = express.Router();
const passengerTripController = new PassengerTripController();
const bookingRequestController = new BookingRequestController();
const ReviewController = require('../controllers/reviewController');
const reviewController = new ReviewController();
const { reviewIdParamSchema } = require('../validation/reviewSchemas');

/**
 * @openapi
 * /passengers/trips/search:
 *   get:
 *     tags:
 *       - Passenger Trips
 *     summary: Search published trips (Passenger only)
 *     description: |
 *       Search for available published trips with future departure.
 *       
 *       **Authorization**: Requires valid JWT cookie (any authenticated user, but intended for passengers).
 *       
 *       **Filters**:
 *       - `qOrigin`: Text search in origin (case-insensitive, partial match)
 *       - `qDestination`: Text search in destination (case-insensitive, partial match)
 *       - `fromDate`: Minimum departure date (ISO 8601)
 *       - `toDate`: Maximum departure date (ISO 8601)
 *       - `page`: Page number (default: 1, min: 1)
 *       - `pageSize`: Results per page (default: 10, min: 1, max: 50)
 *       
 *       **Business Rules**:
 *       - Only returns trips with `status='published'`
 *       - Only returns trips with `departureAt > now` (future trips)
 *       - Results sorted by `departureAt` ascending (soonest first)
 *       
 *       **Security**:
 *       - Text inputs are sanitized (regex special chars escaped)
 *       - No driver PII exposed (only public trip fields)
 *       
 *       **Performance**:
 *       - Indexed queries on status and departureAt
 *       - Pagination enforced (max 50 results per page)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: qOrigin
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         description: Text search in origin (case-insensitive)
 *         example: "Campus"
 *       - in: query
 *         name: qDestination
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         description: Text search in destination (case-insensitive)
 *         example: "Centro"
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Minimum departure date (ISO 8601)
 *         example: "2025-11-01T00:00:00.000Z"
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Maximum departure date (ISO 8601)
 *         example: "2025-11-30T23:59:59.999Z"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *         example: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Results per page
 *         example: 10
 *     responses:
 *       200:
 *         description: Search results with pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TripOfferResponse'
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 pageSize:
 *                   type: integer
 *                   example: 10
 *                 total:
 *                   type: integer
 *                   example: 25
 *                 totalPages:
 *                   type: integer
 *                   example: 3
 *             examples:
 *               success:
 *                 summary: Search results with trips
 *                 value:
 *                   items:
 *                     - id: "66a1b2c3d4e5f6a7b8c9d0e1"
 *                       driverId: "665e2af1b2c3d4e5f6a7b8c9"
 *                       vehicleId: "6680a1b2c3d4e5f6a7b8c9d0"
 *                       origin:
 *                         text: "Campus Norte"
 *                         geo:
 *                           lat: 4.703
 *                           lng: -74.041
 *                       destination:
 *                         text: "Centro"
 *                         geo:
 *                           lat: 4.652
 *                           lng: -74.093
 *                       departureAt: "2025-11-01T07:30:00.000Z"
 *                       estimatedArrivalAt: "2025-11-01T08:10:00.000Z"
 *                       pricePerSeat: 6000
 *                       totalSeats: 3
 *                       status: "published"
 *                       notes: "Two backpacks max."
 *                       createdAt: "2025-10-22T10:00:00.000Z"
 *                       updatedAt: "2025-10-22T10:00:00.000Z"
 *                   page: 1
 *                   pageSize: 10
 *                   total: 1
 *                   totalPages: 1
 *               empty:
 *                 summary: No trips found
 *                 value:
 *                   items: []
 *                   page: 1
 *                   pageSize: 10
 *                   total: 0
 *                   totalPages: 0
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             examples:
 *               invalid_page:
 *                 summary: Invalid page number
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - "page must be at least 1"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               invalid_date_range:
 *                 summary: toDate before fromDate
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - "toDate must be after fromDate"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               exceeds_pageSize:
 *                 summary: pageSize exceeds maximum
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - "pageSize must not exceed 50"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 */
router.get(
  '/trips/search',
  generalRateLimiter,
  authenticate,
  validateRequest(searchTripsQuerySchema, 'query'),
  passengerTripController.searchTrips.bind(passengerTripController)
);

/**
 * @openapi
 * /passengers/bookings:
 *   post:
 *     tags:
 *       - Passenger Trips
 *     summary: Create a booking request (Passenger only)
 *     description: |
 *       Submit a booking request for a published trip with future departure.
 *       
 *       **Authorization**: Requires role='passenger' and valid JWT cookie.
 *       **CSRF Protection**: Required for state-changing operations.
 *       
 *       **Business Rules**:
 *       - Trip must exist and have `status='published'`
 *       - Trip `departureAt` must be in the future
 *       - Passenger cannot have another active (pending) request for the same trip
 *       - Note is optional and must be ≤ 300 characters
 *       - Request starts with `status='pending'`
 *       
 *       **Future**: Accept/decline flow and capacity enforcement will be added in later stories.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tripId
 *             properties:
 *               tripId:
 *                 type: string
 *                 pattern: '^[a-f\d]{24}$'
 *                 description: Trip offer ID (MongoDB ObjectId)
 *                 example: "66a1b2c3d4e5f6a7b8c9d0e1"
 *               note:
 *                 type: string
 *                 maxLength: 300
 *                 description: Optional note for the driver
 *                 example: "I have a small bag."
 *               seats:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Number of seats requested
 *                 example: 1
 *           examples:
 *             with_note:
 *               summary: Request with note
 *               value:
 *                 tripId: "66a1b2c3d4e5f6a7b8c9d0e1"
 *                 note: "I have a small bag."
 *             minimal:
 *               summary: Minimal request
 *               value:
 *                 tripId: "66a1b2c3d4e5f6a7b8c9d0e1"
 *     responses:
 *       201:
 *         description: Booking request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: Booking request ID
 *                   example: "66b1c2d3e4f5a6b7c8d9e0f1"
 *                 tripId:
 *                   type: string
 *                   description: Trip offer ID
 *                   example: "66a1b2c3d4e5f6a7b8c9d0e1"
 *                 passengerId:
 *                   type: string
 *                   description: Passenger user ID
 *                   example: "665e2af1b2c3d4e5f6a7b8c9"
 *                 status:
 *                   type: string
 *                   enum: [pending]
 *                   description: Request status (always 'pending' on creation)
 *                   example: "pending"
 *                 note:
 *                   type: string
 *                   description: Optional note from passenger
 *                   example: "I have a small bag."
 *                 seats:
 *                   type: integer
 *                   description: Number of seats requested
 *                   example: 1
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                   description: Request creation timestamp
 *                   example: "2025-10-23T01:15:00.000Z"
 *             example:
 *               id: "66b1c2d3e4f5a6b7c8d9e0f1"
 *               tripId: "66a1b2c3d4e5f6a7b8c9d0e1"
 *               passengerId: "665e2af1b2c3d4e5f6a7b8c9"
 *               status: "pending"
 *               note: "I have a small bag."
 *               seats: 1
 *               createdAt: "2025-10-23T01:15:00.000Z"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             examples:
 *               missing_tripId:
 *                 summary: Missing tripId
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "tripId"
 *                       issue: "tripId is required"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               invalid_tripId:
 *                 summary: Invalid tripId format
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "tripId"
 *                       issue: "tripId must be a valid MongoDB ObjectId"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               note_too_long:
 *                 summary: Note exceeds 300 characters
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "note"
 *                       issue: "note must not exceed 300 characters"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden (not a passenger or CSRF token missing)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorForbidden'
 *             examples:
 *               forbidden_role:
 *                 summary: Only passengers can create booking requests
 *                 value:
 *                   code: "forbidden_role"
 *                   message: "Only passengers can create booking requests"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               csrf_missing:
 *                 summary: CSRF token missing or invalid
 *                 value:
 *                   code: "csrf_mismatch"
 *                   message: "CSRF token missing or invalid"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       404:
 *         description: Trip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "trip_not_found"
 *                 message:
 *                   type: string
 *                   example: "Trip offer not found"
 *                 correlationId:
 *                   type: string
 *       409:
 *         description: Conflict (duplicate request or invalid trip state)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                 message:
 *                   type: string
 *                 correlationId:
 *                   type: string
 *             examples:
 *               duplicate_request:
 *                 summary: Passenger already has a pending request for this trip
 *                 value:
 *                   code: "duplicate_request"
 *                   message: "You already have a pending request for this trip"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               invalid_trip_state:
 *                 summary: Trip is not published or already departed
 *                 value:
 *                   code: "invalid_trip_state"
 *                   message: "Trip is not published or already departed"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.post(
  '/bookings',
  generalRateLimiter,
  authenticate,
  requireRole('passenger'),
  requireCsrf,
  validateRequest(createBookingRequestSchema),
  bookingRequestController.createBookingRequest.bind(bookingRequestController)
);

/**
 * @openapi
 * /passengers/bookings:
 *   get:
 *     tags:
 *       - Passenger Trips
 *     summary: List my booking requests (Passenger only)
 *     description: |
 *       List the caller's booking requests with optional filters and pagination.
 *       
 *       **Authorization**: Requires role='passenger' and valid JWT cookie.
 *       
 *       **Filters**:
 *       - `status`: Filter by status (single or multiple)
 *       - `fromDate`: Minimum createdAt date (ISO 8601)
 *       - `toDate`: Maximum createdAt date (ISO 8601)
 *       - `page`: Page number (default: 1, min: 1)
 *       - `pageSize`: Results per page (default: 10, min: 1, max: 50)
 *       
 *       **Business Rules**:
 *       - Returns only the caller's booking requests (owner-only)
 *       - Results sorted by `createdAt` desc (most recent first)
 *       - Pagination enforced (max 50 results per page)
 *       
 *       **Security**:
 *       - No access to other passengers' requests
 *       - Full DTO with trip details not populated (use GET /trips/:id separately)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [pending, canceled_by_passenger, accepted, declined, expired]
 *             - type: array
 *               items:
 *                 type: string
 *                 enum: [pending, canceled_by_passenger, accepted, declined, expired]
 *         description: Filter by status (single or array)
 *         example: pending
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Minimum createdAt date (ISO 8601)
 *         example: "2025-10-01T00:00:00.000Z"
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Maximum createdAt date (ISO 8601)
 *         example: "2025-10-31T23:59:59.999Z"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *         example: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Results per page
 *         example: 10
 *     responses:
 *       200:
 *         description: List of booking requests with pagination
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
 *                       id:
 *                         type: string
 *                       tripId:
 *                         type: string
 *                       passengerId:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [pending, canceled_by_passenger, accepted, declined, expired]
 *                       note:
 *                         type: string
 *                       seats:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 pageSize:
 *                   type: integer
 *                   example: 10
 *                 total:
 *                   type: integer
 *                   example: 7
 *                 totalPages:
 *                   type: integer
 *                   example: 1
 *             examples:
 *               with_results:
 *                 summary: List with results
 *                 value:
 *                   items:
 *                     - id: "66b1c2d3e4f5a6b7c8d9e0f1"
 *                       tripId: "66a1b2c3d4e5f6a7b8c9d0e1"
 *                       passengerId: "665e2af1b2c3d4e5f6a7b8c9"
 *                       status: "pending"
 *                       note: "I have a small bag."
 *                       seats: 1
 *                       createdAt: "2025-10-23T01:15:00.000Z"
 *                     - id: "66b1c2d3e4f5a6b7c8d9e0f2"
 *                       tripId: "66a1b2c3d4e5f6a7b8c9d0e2"
 *                       passengerId: "665e2af1b2c3d4e5f6a7b8c9"
 *                       status: "accepted"
 *                       note: ""
 *                       seats: 1
 *                       createdAt: "2025-10-22T10:30:00.000Z"
 *                   page: 1
 *                   pageSize: 10
 *                   total: 2
 *                   totalPages: 1
 *               empty:
 *                 summary: Empty list
 *                 value:
 *                   items: []
 *                   page: 1
 *                   pageSize: 10
 *                   total: 0
 *                   totalPages: 0
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             examples:
 *               invalid_page:
 *                 summary: Invalid page number
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Invalid query parameters"
 *                   details:
 *                     - "page must be at least 1"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               invalid_status:
 *                 summary: Invalid status value
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Invalid query parameters"
 *                   details:
 *                     - "status must be one of: pending, canceled_by_passenger, accepted, declined, expired"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               exceeds_pageSize:
 *                 summary: pageSize exceeds maximum
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Invalid query parameters"
 *                   details:
 *                     - "pageSize must not exceed 50"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden (not a passenger)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorForbidden'
 *             example:
 *               code: "forbidden_role"
 *               message: "Only passengers can list booking requests"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.get(
  '/bookings',
  generalRateLimiter,
  authenticate,
  requireRole('passenger'),
  validateRequest(listBookingRequestsQuerySchema, 'query'),
  bookingRequestController.listMyBookingRequests.bind(bookingRequestController)
);

/**
 * @openapi
 * /passengers/bookings/{bookingId}/cancel:
 *   post:
 *     tags:
 *       - Passenger Trips
 *     summary: Cancel my booking request (US-3.4.3)
 *     description: |
 *       Cancel a booking request owned by the caller. Supports both pending and accepted bookings.
 *       
 *       **Authorization**: Requires role='passenger', valid JWT cookie, and ownership.
 *       **CSRF Protection**: Required for state-changing operations.
 *       
 *       **Business Rules**:
 *       - Only the request owner (passenger) can cancel
 *       - Pending: Simple status update → `canceled_by_passenger`
 *       - Accepted: Transaction to decrement seat ledger + set refund flag
 *       - Optional reason stored for audit trail
 *       - **Idempotent**: If already canceled, returns 200 with zero effects
 *       
 *       **Returns**:
 *       - Effects summary with `ledgerReleased` (0 for pending, seats for accepted)
 *       - `refundCreated` flag (true if paid booking eligible for refund - US-4.2)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *         description: Booking request ID (MongoDB ObjectId)
 *         example: "66b1c2d3e4f5a6b7c8d9e0f1"
 *     requestBody:
 *       description: Optional cancellation reason
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional reason for cancellation (audit trail)
 *                 example: "I can't make it"
 *           examples:
 *             with_reason:
 *               value:
 *                 reason: "I can't make it"
 *             without_reason:
 *               value: {}
 *     responses:
 *       200:
 *         description: Booking request canceled with effects summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "66b1c2d3e4f5a6b7c8d9e0f1"
 *                 status:
 *                   type: string
 *                   enum: [canceled_by_passenger]
 *                   example: "canceled_by_passenger"
 *                 effects:
 *                   type: object
 *                   properties:
 *                     ledgerReleased:
 *                       type: integer
 *                       description: Seats deallocated (0 for pending, booking.seats for accepted)
 *                       example: 1
 *                     refundCreated:
 *                       type: boolean
 *                       description: Whether RefundIntent was created (US-4.2)
 *                       example: true
 *             examples:
 *               accepted_booking:
 *                 summary: Accepted booking canceled (with seat deallocation)
 *                 value:
 *                   id: "66b1c2d3e4f5a6b7c8d9e0f1"
 *                   status: "canceled_by_passenger"
 *                   effects:
 *                     ledgerReleased: 1
 *                     refundCreated: true
 *               pending_booking:
 *                 summary: Pending booking canceled (no seat deallocation)
 *                 value:
 *                   id: "66b1c2d3e4f5a6b7c8d9e0f1"
 *                   status: "canceled_by_passenger"
 *                   effects:
 *                     ledgerReleased: 0
 *                     refundCreated: false
 *       400:
 *         description: Invalid request (bookingId format or reason too long)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden (not owner or CSRF token missing)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "forbidden_owner"
 *                 message:
 *                   type: string
 *                   example: "You cannot modify this booking request"
 *       404:
 *         description: Booking request not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "booking_not_found"
 *                 message:
 *                   type: string
 *                   example: "Booking request not found"
 *       409:
 *         description: Conflict (invalid state transition)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "invalid_state"
 *                 message:
 *                   type: string
 *                   example: "Request cannot be canceled in its current state"
 */
router.post(
  '/bookings/:bookingId/cancel',
  generalRateLimiter,
  authenticate,
  requireRole('passenger'),
  requireCsrf,
  validateRequest(bookingIdParamSchema, 'params'),
  validateRequest(cancelBookingRequestSchema, 'body'),
  bookingRequestController.cancelMyBookingRequest.bind(bookingRequestController)
);

// GET my review for a trip
router.get(
  '/trips/:tripId/reviews/me',
  authenticate,
  requireRole('passenger'),
  validateRequest(require('../validation/bookingRequestSchemas').tripIdParamSchema, 'params'),
  reviewController.getMyReviewForTrip.bind(reviewController)
);

// DELETE my review for a trip (soft-delete within 24h window)
router.delete(
  '/trips/:tripId/reviews/:reviewId',
  authenticate,
  requireRole('passenger'),
  requireCsrf,
  validateRequest(require('../validation/reviewSchemas').reviewParamsSchema, 'params'),
  reviewController.deleteMyReview.bind(reviewController)
);

// PATCH edit my review within 24h
router.patch(
  '/trips/:tripId/reviews/:reviewId',
  authenticate,
  requireRole('passenger'),
  requireCsrf,
  validateRequest(require('../validation/reviewSchemas').reviewParamsSchema, 'params'),
  validateRequest(require('../validation/reviewSchemas').updateReviewBodySchema, 'body'),
  reviewController.editMyReview.bind(reviewController)
);

module.exports = router;

