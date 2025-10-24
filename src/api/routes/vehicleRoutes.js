const express = require('express');
const VehicleController = require('../controllers/vehicleController');
const validateRequest = require('../middlewares/validateRequest');
const { createVehicleSchema, updateVehicleSchema } = require('../validation/vehicleSchemas');
const { vehicleUpload, handleUploadError, cleanupOnError } = require('../middlewares/uploadMiddleware');
const { generalRateLimiter } = require('../middlewares/rateLimiter');
const authenticate = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/authenticate');
const requireCsrf = require('../middlewares/requireCsrf');

const router = express.Router();
const vehicleController = new VehicleController();

/**
 * Vehicle Routes
 * All routes require authentication + driver role (RBAC)
 * Protected by authenticate + requireRole('driver') middlewares
 */

/**
 * POST /api/drivers/vehicle
 * Create a new vehicle for the authenticated driver
 * Supports multipart/form-data with vehiclePhoto and soatPhoto
 * Enforces one-vehicle-per-driver rule and prevents duplicate plates
 * 
 * Request (multipart/form-data):
 * - plate: string (required) - Format: ABC123
 * - brand: string (required) - Min 2, Max 60 chars
 * - model: string (required) - Min 1, Max 60 chars
 * - capacity: number (required) - Min 1, Max 20
 * - vehiclePhoto: file (optional) - Image up to 5MB
 * - soatPhoto: file (optional) - Image up to 5MB
 * - driverId: string (temporary, for testing without auth)
 * 
 * Responses:
 * - 201: Vehicle created successfully
 * - 400: Validation error (invalid_schema)
 * - 401: Unauthorized (not authenticated)
 * - 409: Conflict (one_vehicle_rule or duplicate_plate)
 * - 413: File too large (payload_too_large)
 */
router.post(
  '/vehicle',
  generalRateLimiter,
  authenticate,                // Verify JWT cookie
  requireRole('driver'),       // Enforce driver role (RBAC)
  requireCsrf,                 // CSRF protection for state-changing route
  vehicleUpload.fields([
    { name: 'vehiclePhoto', maxCount: 1 },
    { name: 'soatPhoto', maxCount: 1 }
  ]),
  handleUploadError,
  cleanupOnError,
  validateRequest(createVehicleSchema, 'body'),
  vehicleController.createVehicle.bind(vehicleController)
);

/**
 * GET /api/drivers/vehicle
 * Get the authenticated driver's vehicle (owner-only read)
 * Uses DTO to hide internals
 * Enforces RBAC: driver role required
 * 
 * Query params:
 * - driverId: string (temporary, for testing without auth)
 * 
 * Responses:
 * - 200: Vehicle found - Returns sanitized DTO
 * - 401: Unauthorized (not authenticated)
 * - 403: Forbidden (forbidden_role - passenger trying to access)
 * - 404: Vehicle not found (vehicle_not_found - driver has no vehicle)
 */
router.get(
  '/vehicle',
  generalRateLimiter,
  authenticate,                // Verify JWT cookie
  requireRole('driver'),       // Enforce driver role (RBAC)
  vehicleController.getMyVehicle.bind(vehicleController)
);

/**
 * PUT /api/drivers/vehicle
 * Update the authenticated driver's vehicle (full update)
 * 
 * Request body (multipart/form-data):
 * - brand: string (optional) - Min 2, Max 60 chars
 * - model: string (optional) - Min 1, Max 60 chars
 * - capacity: number (optional) - Min 1, Max 20
 * - vehiclePhoto: file (optional) - Image up to 5MB
 * - soatPhoto: file (optional) - Image up to 5MB
 * - driverId: string (temporary, for testing without auth)
 * 
 * Responses:
 * - 200: Vehicle updated successfully
 * - 400: Validation error (invalid_schema)
 * - 401: Unauthorized
 * - 404: Vehicle not found (vehicle_not_found)
 * - 413: File too large (payload_too_large)
 */
router.put(
  '/vehicle',
  generalRateLimiter,
  // TODO: Add authentication middleware here
  // authenticate,
  // requireRole('driver'),
  vehicleUpload.fields([
    { name: 'vehiclePhoto', maxCount: 1 },
    { name: 'soatPhoto', maxCount: 1 }
  ]),
  handleUploadError,
  cleanupOnError,
  validateRequest(updateVehicleSchema, 'body'),
  vehicleController.updateMyVehicle.bind(vehicleController)
);

/**
 * PATCH /api/drivers/vehicle
 * Partially update the authenticated driver's vehicle
 * Performs atomic image replacement (store new → persist → delete old)
 * 
 * Request body (multipart/form-data - all fields optional):
 * - brand: string (optional) - Min 2, Max 60 chars
 * - model: string (optional) - Min 1, Max 60 chars
 * - capacity: number (optional) - Min 1, Max 20
 * - vehiclePhoto: file (optional) - Image up to 5MB, replaces existing
 * - soatPhoto: file (optional) - Image up to 5MB, replaces existing
 * - driverId: string (temporary, for testing without auth)
 * 
 * Responses:
 * - 200: Vehicle updated successfully
 * - 400: Validation error (invalid_schema)
 * - 401: Unauthorized
 * - 403: Forbidden (forbidden_role)
 * - 404: Vehicle not found (vehicle_not_found)
 * - 409: Rule violation (one_vehicle_rule)
 * - 413: File too large (payload_too_large)
 */
router.patch(
  '/vehicle',
  generalRateLimiter,
  authenticate,                // Verify JWT cookie
  requireRole('driver'),       // Enforce driver role (RBAC)
  requireCsrf,                 // CSRF protection for state-changing route
  vehicleUpload.fields([
    { name: 'vehiclePhoto', maxCount: 1 },
    { name: 'soatPhoto', maxCount: 1 }
  ]),
  handleUploadError,
  cleanupOnError,
  validateRequest(updateVehicleSchema, 'body'),
  vehicleController.updateMyVehicle.bind(vehicleController)
);

/**
 * DELETE /api/drivers/vehicle
 * Delete the authenticated driver's vehicle
 * 
 * Query params:
 * - driverId: string (temporary, for testing without auth)
 * 
 * Responses:
 * - 204: Vehicle deleted successfully
 * - 401: Unauthorized
 * - 404: Vehicle not found
 */
router.delete(
  '/vehicle',
  generalRateLimiter,
  authenticate,                // Verify JWT cookie
  requireRole('driver'),       // Enforce driver role (RBAC)
  requireCsrf,                 // CSRF protection for state-changing route
  vehicleController.deleteMyVehicle.bind(vehicleController)
);

/**
 * GET /api/vehicles/:driverId/has-vehicle
 * Check if a driver has a vehicle
 * Public endpoint for validation during registration
 * 
 * Responses:
 * - 200: Check result { driverId, hasVehicle }
 * - 400: Invalid request
 */
router.get(
  '/:driverId/has-vehicle',
  generalRateLimiter,
  vehicleController.checkDriverHasVehicle.bind(vehicleController)
);

module.exports = router;

