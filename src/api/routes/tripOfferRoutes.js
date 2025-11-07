const express = require('express');
const TripOfferController = require('../controllers/tripOfferController');
const validateRequest = require('../middlewares/validateRequest');
const { createTripOfferSchema, updateTripOfferSchema, listTripsQuerySchema, tripIdParamSchema } = require('../validation/tripOfferSchemas');
const { generalRateLimiter } = require('../middlewares/rateLimiter');
const authenticate = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/authenticate');
const requireCsrf = require('../middlewares/requireCsrf');
const requireDriverVerified = require('../middlewares/verifyDriver');

const router = express.Router();
const tripOfferController = new TripOfferController();

/**
 * @openapi
 * /drivers/trips:
 *   post:
 *     tags:
 *       - Trip Offers
 *     summary: Create a new trip offer (Driver only)
 *     description: |
 *       Creates a new trip offer for the authenticated driver.
 *       
 *       **Authorization**: Requires role='driver' and valid JWT cookie.
 *       
 *       **Business Rules**:
 *       - vehicleId must be owned by the driver
 *       - departureAt must be in the future (for published trips)
 *       - estimatedArrivalAt must be after departureAt
 *       - totalSeats must be ≤ vehicle capacity
 *       - Optional: rejects overlapping published trips (same driver, same time window)
 *       
 *       **Status**:
 *       - `draft`: Trip is not visible to passengers, can be published later
 *       - `published`: Trip is visible to passengers and can receive bookings
 *       
 *       **Structured Logging**:
 *       - All requests logged with correlation ID
 *       - PII (origin/destination text) redacted in logs
 *       - Only status codes and trip IDs logged
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicleId
 *               - origin
 *               - destination
 *               - departureAt
 *               - estimatedArrivalAt
 *               - pricePerSeat
 *               - totalSeats
 *             properties:
 *               vehicleId:
 *                 type: string
 *                 pattern: '^[a-f\d]{24}$'
 *                 example: "6680a1b2c3d4e5f6a7b8c9d0"
 *               origin:
 *                 type: object
 *                 required:
 *                   - text
 *                   - geo
 *                 properties:
 *                   text:
 *                     type: string
 *                     minLength: 2
 *                     maxLength: 200
 *                     example: "Campus Norte - Universidad de La Sabana"
 *                   geo:
 *                     type: object
 *                     required:
 *                       - lat
 *                       - lng
 *                     properties:
 *                       lat:
 *                         type: number
 *                         minimum: -90
 *                         maximum: 90
 *                         example: 4.703
 *                       lng:
 *                         type: number
 *                         minimum: -180
 *                         maximum: 180
 *                         example: -74.041
 *               destination:
 *                 type: object
 *                 required:
 *                   - text
 *                   - geo
 *                 properties:
 *                   text:
 *                     type: string
 *                     minLength: 2
 *                     maxLength: 200
 *                     example: "Campus Sur - Universidad de La Sabana"
 *                   geo:
 *                     type: object
 *                     required:
 *                       - lat
 *                       - lng
 *                     properties:
 *                       lat:
 *                         type: number
 *                         minimum: -90
 *                         maximum: 90
 *                         example: 4.627
 *                       lng:
 *                         type: number
 *                         minimum: -180
 *                         maximum: 180
 *                         example: -74.064
 *               departureAt:
 *                 type: string
 *                 format: date-time
 *                 description: ISO 8601 datetime (must be in the future for published trips)
 *                 example: "2025-11-01T07:30:00.000Z"
 *               estimatedArrivalAt:
 *                 type: string
 *                 format: date-time
 *                 description: ISO 8601 datetime (must be after departureAt)
 *                 example: "2025-11-01T08:10:00.000Z"
 *               pricePerSeat:
 *                 type: number
 *                 minimum: 0
 *                 multipleOf: 0.01
 *                 description: Price per seat (2 decimal places)
 *                 example: 6000
 *               totalSeats:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of available seats (must be ≤ vehicle capacity)
 *                 example: 3
 *               status:
 *                 type: string
 *                 enum: [draft, published]
 *                 default: published
 *                 description: Trip visibility status
 *                 example: "published"
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional notes for passengers
 *                 example: "Two backpacks max. No pets allowed."
 *           examples:
 *             published:
 *               summary: Published trip (visible to passengers)
 *               value:
 *                 vehicleId: "6680a1b2c3d4e5f6a7b8c9d0"
 *                 origin:
 *                   text: "Campus Norte - Universidad de La Sabana"
 *                   geo:
 *                     lat: 4.703
 *                     lng: -74.041
 *                 destination:
 *                   text: "Campus Sur - Universidad de La Sabana"
 *                   geo:
 *                     lat: 4.627
 *                     lng: -74.064
 *                 departureAt: "2025-11-01T07:30:00.000Z"
 *                 estimatedArrivalAt: "2025-11-01T08:10:00.000Z"
 *                 pricePerSeat: 6000
 *                 totalSeats: 3
 *                 status: "published"
 *                 notes: "Two backpacks max."
 *             draft:
 *               summary: Draft trip (not visible, can publish later)
 *               value:
 *                 vehicleId: "6680a1b2c3d4e5f6a7b8c9d0"
 *                 origin:
 *                   text: "Chía Centro"
 *                   geo:
 *                     lat: 4.858
 *                     lng: -74.059
 *                 destination:
 *                   text: "Bogotá Centro"
 *                   geo:
 *                     lat: 4.598
 *                     lng: -74.076
 *                 departureAt: "2025-11-05T14:00:00.000Z"
 *                 estimatedArrivalAt: "2025-11-05T15:30:00.000Z"
 *                 pricePerSeat: 8000
 *                 totalSeats: 4
 *                 status: "draft"
 *                 notes: ""
 *     responses:
 *       201:
 *         description: Trip offer created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TripOfferResponse'
 *             example:
 *               id: "66a1b2c3d4e5f6a7b8c9d0e1"
 *               driverId: "665e2af1b2c3d4e5f6a7b8c9"
 *               vehicleId: "6680a1b2c3d4e5f6a7b8c9d0"
 *               origin:
 *                 text: "Campus Norte - Universidad de La Sabana"
 *                 geo:
 *                   lat: 4.703
 *                   lng: -74.041
 *               destination:
 *                 text: "Campus Sur - Universidad de La Sabana"
 *                 geo:
 *                   lat: 4.627
 *                   lng: -74.064
 *               departureAt: "2025-11-01T07:30:00.000Z"
 *               estimatedArrivalAt: "2025-11-01T08:10:00.000Z"
 *               pricePerSeat: 6000
 *               totalSeats: 3
 *               status: "published"
 *               notes: "Two backpacks max."
 *               createdAt: "2025-10-22T10:00:00.000Z"
 *               updatedAt: "2025-10-22T10:00:00.000Z"
 *       400:
 *         description: Invalid request (validation errors, time/capacity violations)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             examples:
 *               invalid_schema:
 *                 summary: Validation error
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "departureAt"
 *                       issue: "departureAt must be a valid ISO 8601 date"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               departure_in_past:
 *                 summary: Departure time in the past
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "departureAt must be in the future"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               exceeds_capacity:
 *                 summary: Total seats exceeds vehicle capacity
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "totalSeats (5) exceeds vehicle capacity (4)"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden (not a driver or vehicle ownership violation)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorForbidden'
 *             examples:
 *               not_driver:
 *                 summary: User is not a driver
 *                 value:
 *                   code: "forbidden"
 *                   message: "Only drivers can create trip offers"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               forbidden_owner:
 *                 summary: Vehicle does not belong to driver
 *                 value:
 *                   code: "forbidden_owner"
 *                   message: "Vehicle does not belong to the driver"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       409:
 *         description: Conflict (overlapping trip)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "overlapping_trip"
 *                 message:
 *                   type: string
 *                   example: "You have another published trip during this time window"
 *                 correlationId:
 *                   type: string
 *             example:
 *               code: "overlapping_trip"
 *               message: "You have another published trip during this time window"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.post(
  '/trips',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  // requireDriverVerified, // Temporarily disabled for testing
  requireCsrf,
  validateRequest(createTripOfferSchema),
  tripOfferController.createTripOffer.bind(tripOfferController)
);

/**
 * @openapi
 * /drivers/trips:
 *   get:
 *     tags:
 *       - Trip Offers
 *     summary: List my trip offers (Driver only)
 *     description: |
 *       Returns paginated list of trip offers for the authenticated driver.
 *       Supports filtering by status, date range, and pagination.
 *       
 *       **Authorization**: Requires role='driver' and valid JWT cookie.
 *       
 *       **Filters**:
 *       - `status`: Filter by one or multiple statuses (draft, published, canceled, completed)
 *       - `fromDate`: Filter trips departing on or after this date
 *       - `toDate`: Filter trips departing on or before this date
 *       
 *       **Pagination**:
 *       - `page`: Page number (1-based, default: 1)
 *       - `pageSize`: Items per page (1-50, default: 10)
 *       
 *       **Sorting**: Results sorted by `departureAt` descending (most recent first)
 *       
 *       **Security**: Only returns trips owned by the authenticated driver
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [draft, published, canceled, completed]
 *             - type: array
 *               items:
 *                 type: string
 *                 enum: [draft, published, canceled, completed]
 *         description: Filter by trip status (can be multiple)
 *         example: published
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter trips departing on or after this date
 *         example: "2025-10-01T00:00:00.000Z"
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter trips departing on or before this date
 *         example: "2025-12-31T23:59:59.999Z"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number (1-based)
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of trip offers with pagination metadata
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
 *                   example: 14
 *                 totalPages:
 *                   type: integer
 *                   example: 2
 *             examples:
 *               with_items:
 *                 summary: Response with items
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
 *                         text: "Campus Sur"
 *                         geo:
 *                           lat: 4.627
 *                           lng: -74.064
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
 *                   total: 14
 *                   totalPages: 2
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
 *               invalid_status:
 *                 summary: Invalid status value
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "status"
 *                       issue: "status must be one of: draft, published, canceled, completed"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               invalid_date:
 *                 summary: Invalid date format
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "fromDate"
 *                       issue: "fromDate must be a valid ISO 8601 date"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               toDate_before_fromDate:
 *                 summary: toDate before fromDate
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "toDate"
 *                       issue: "toDate must be after fromDate"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden (not a driver)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorForbidden'
 */
router.get(
  '/trips',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  validateRequest(listTripsQuerySchema, 'query'),
  tripOfferController.listMyTrips.bind(tripOfferController)
);

/**
 * @openapi
 * /drivers/trips/{id}:
 *   get:
 *     tags:
 *       - Trip Offers
 *     summary: Get a single trip offer (Driver only, owner-only)
 *     description: Returns details of a specific trip offer. Only the owner driver can view their trips.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *         description: Trip offer ID (MongoDB ObjectId)
 *         example: "66a1b2c3d4e5f6a7b8c9d0e1"
 *     responses:
 *       200:
 *         description: Trip offer details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TripOfferResponse'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden (not owner or not a driver)
 *       404:
 *         description: Trip not found
 */
router.get(
  '/trips/:id',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  validateRequest(tripIdParamSchema, 'params'),
  tripOfferController.getTripOfferById.bind(tripOfferController)
);

/**
 * @openapi
 * /drivers/trips/{id}:
 *   patch:
 *     tags:
 *       - Trip Offers
 *     summary: Update a trip offer (Driver only, owner-only)
 *     description: |
 *       Partial update of a trip offer. Only the owner driver can update their trips.
 *       
 *       **Authorization**: Requires role='driver', valid JWT cookie, and ownership.
 *       **CSRF Protection**: Required for state-changing operations.
 *       
 *       **Allowed Fields**:
 *       - `pricePerSeat`: Update price
 *       - `totalSeats`: Update capacity (must be ≥ 1 and ≤ vehicle capacity)
 *       - `notes`: Update trip notes
 *       - `status`: Transition status (draft ↔ published, published → canceled)
 *       
 *       **Business Rules**:
 *       - Only draft trips can have times edited (if enabled in config)
 *       - Cannot edit canceled or completed trips
 *       - Status transitions must be legal
 *       - totalSeats cannot be less than booked seats (future validation)
 *       - All updates re-validate against vehicle capacity
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *         description: Trip offer ID (MongoDB ObjectId)
 *         example: "66a1b2c3d4e5f6a7b8c9d0e1"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               pricePerSeat:
 *                 type: number
 *                 minimum: 0
 *                 multipleOf: 0.01
 *                 description: Price per seat
 *                 example: 6500
 *               totalSeats:
 *                 type: integer
 *                 minimum: 1
 *                 description: Total seats (must be ≤ vehicle capacity)
 *                 example: 4
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Trip notes
 *                 example: "Meet at Gate 3. Be punctual."
 *               status:
 *                 type: string
 *                 enum: [draft, published, canceled, completed]
 *                 description: Trip status (legal transitions only)
 *                 example: "published"
 *           examples:
 *             update_price:
 *               summary: Update price and notes
 *               value:
 *                 pricePerSeat: 6500
 *                 notes: "Meet at Gate 3"
 *             publish_draft:
 *               summary: Publish a draft trip
 *               value:
 *                 status: "published"
 *             update_capacity:
 *               summary: Update total seats
 *               value:
 *                 totalSeats: 4
 *     responses:
 *       200:
 *         description: Trip updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TripOfferResponse'
 *             example:
 *               id: "66a1b2c3d4e5f6a7b8c9d0e1"
 *               driverId: "665e2af1b2c3d4e5f6a7b8c9"
 *               vehicleId: "6680a1b2c3d4e5f6a7b8c9d0"
 *               origin:
 *                 text: "Campus Norte"
 *                 geo:
 *                   lat: 4.703
 *                   lng: -74.041
 *               destination:
 *                 text: "Campus Sur"
 *                 geo:
 *                   lat: 4.627
 *                   lng: -74.064
 *               departureAt: "2025-11-01T07:30:00.000Z"
 *               estimatedArrivalAt: "2025-11-01T08:10:00.000Z"
 *               pricePerSeat: 6500
 *               totalSeats: 3
 *               status: "published"
 *               notes: "Meet at Gate 3"
 *               createdAt: "2025-10-22T10:00:00.000Z"
 *               updatedAt: "2025-10-22T10:15:00.000Z"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorValidation'
 *             examples:
 *               invalid_price:
 *                 summary: Invalid price
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "Validation failed"
 *                   details:
 *                     - field: "pricePerSeat"
 *                       issue: "pricePerSeat must be a positive number"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               exceeds_capacity:
 *                 summary: Total seats exceeds vehicle capacity
 *                 value:
 *                   code: "invalid_schema"
 *                   message: "totalSeats (5) exceeds vehicle capacity (4)"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden (not owner or not a driver)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorForbidden'
 *             examples:
 *               not_owner:
 *                 summary: Trip does not belong to the driver
 *                 value:
 *                   code: "forbidden_owner"
 *                   message: "Trip does not belong to the driver"
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
 *         description: Conflict (invalid status transition or editing restriction)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "invalid_transition"
 *                 message:
 *                   type: string
 *                 correlationId:
 *                   type: string
 *             examples:
 *               invalid_transition:
 *                 summary: Invalid status transition
 *                 value:
 *                   code: "invalid_transition"
 *                   message: "Cannot transition from canceled to published"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 *               cannot_edit_published_time:
 *                 summary: Cannot edit times on published trip
 *                 value:
 *                   code: "invalid_transition"
 *                   message: "Cannot edit departureAt for a published trip"
 *                   correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.patch(
  '/trips/:id',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  requireCsrf,
  validateRequest(tripIdParamSchema, 'params'),
  validateRequest(updateTripOfferSchema),
  tripOfferController.updateTripOffer.bind(tripOfferController)
);

/**
 * @openapi
 * /drivers/trips/{id}:
 *   delete:
 *     tags:
 *       - Trip Offers
 *     summary: Cancel a trip offer (Driver only, owner-only)
 *     description: |
 *       Soft-cancel a trip by changing status to `canceled`. Only the owner driver can cancel their trips.
 *       
 *       **Authorization**: Requires role='driver', valid JWT cookie, and ownership.
 *       **CSRF Protection**: Required for state-changing operations.
 *       
 *       **Business Rules**:
 *       - Can cancel trips with status `published` or `draft`
 *       - Cannot cancel `completed` trips (409 invalid_transition)
 *       - **Idempotent**: Repeated cancels return 200 with status=canceled
 *       
 *       **Future**: Passenger notifications & refund logic will be added in booking story.
 *       
 *       **Status Transition**:
 *       - `published` → `canceled`: OK
 *       - `draft` → `canceled`: OK
 *       - `completed` → `canceled`: 409 invalid_transition
 *       - `canceled` → `canceled`: 200 (idempotent)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f\d]{24}$'
 *         description: Trip offer ID (MongoDB ObjectId)
 *         example: "66a1b2c3d4e5f6a7b8c9d0e1"
 *     responses:
 *       200:
 *         description: Trip canceled successfully (or already canceled - idempotent)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TripOfferResponse'
 *             examples:
 *               canceled:
 *                 summary: Trip successfully canceled
 *                 value:
 *                   id: "66a1b2c3d4e5f6a7b8c9d0e1"
 *                   driverId: "665e2af1b2c3d4e5f6a7b8c9"
 *                   vehicleId: "6680a1b2c3d4e5f6a7b8c9d0"
 *                   origin:
 *                     text: "Campus Norte"
 *                     geo:
 *                       lat: 4.703
 *                       lng: -74.041
 *                   destination:
 *                     text: "Campus Sur"
 *                     geo:
 *                       lat: 4.627
 *                       lng: -74.064
 *                   departureAt: "2025-11-01T07:30:00.000Z"
 *                   estimatedArrivalAt: "2025-11-01T08:10:00.000Z"
 *                   pricePerSeat: 6000
 *                   totalSeats: 3
 *                   status: "canceled"
 *                   notes: "Trip canceled by driver"
 *                   createdAt: "2025-10-22T10:00:00.000Z"
 *                   updatedAt: "2025-10-22T11:30:00.000Z"
 *               already_canceled:
 *                 summary: Already canceled (idempotent)
 *                 value:
 *                   id: "66a1b2c3d4e5f6a7b8c9d0e1"
 *                   status: "canceled"
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorUnauthorized'
 *       403:
 *         description: Forbidden (not owner or not a driver)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorForbidden'
 *             examples:
 *               not_owner:
 *                 summary: Trip does not belong to the driver
 *                 value:
 *                   code: "forbidden_owner"
 *                   message: "Trip does not belong to the driver"
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
 *         description: Conflict (cannot cancel completed trip)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "invalid_transition"
 *                 message:
 *                   type: string
 *                   example: "Completed trips cannot be canceled"
 *                 correlationId:
 *                   type: string
 *             example:
 *               code: "invalid_transition"
 *               message: "Completed trips cannot be canceled"
 *               correlationId: "123e4567-e89b-12d3-a456-426614174000"
 */
router.delete(
  '/trips/:id',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  requireCsrf,
  validateRequest(tripIdParamSchema, 'params'),
  tripOfferController.cancelTripOffer.bind(tripOfferController)
);

/**
 * Get bookings for a trip
 */
router.get(
  '/trips/:id/bookings',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  validateRequest(tripIdParamSchema, 'params'),
  tripOfferController.getTripBookings.bind(tripOfferController)
);

/**
 * Accept a booking
 */
router.post(
  '/trips/:tripId/bookings/:bookingId/accept',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  requireCsrf,
  tripOfferController.acceptBooking.bind(tripOfferController)
);

/**
 * Decline a booking
 */
router.post(
  '/trips/:tripId/bookings/:bookingId/decline',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  requireCsrf,
  tripOfferController.declineBooking.bind(tripOfferController)
);

/**
 * Start a trip (change status from published to in_progress)
 */
router.post(
  '/trips/:id/start',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  requireCsrf,
  validateRequest(tripIdParamSchema, 'params'),
  tripOfferController.startTrip.bind(tripOfferController)
);

/**
 * Complete a trip (change status from in_progress to completed)
 */
router.post(
  '/trips/:id/complete',
  generalRateLimiter,
  authenticate,
  requireRole('driver'),
  requireCsrf,
  validateRequest(tripIdParamSchema, 'params'),
  tripOfferController.completeTrip.bind(tripOfferController)
);

module.exports = router;

