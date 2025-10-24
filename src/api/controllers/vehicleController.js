const VehicleService = require('../../domain/services/VehicleService');
const CreateVehicleDto = require('../../domain/dtos/CreateVehicleDto');
const UpdateVehicleDto = require('../../domain/dtos/UpdateVehicleDto');

/**
 * Vehicle Controller
 * Handles HTTP requests for vehicle management
 * All endpoints require authentication (driverId from JWT)
 */
class VehicleController {
  constructor() {
    this.vehicleService = new VehicleService();
  }

  /**
   * POST /api/vehicles
   * Create a new vehicle for the authenticated driver
   * Supports multipart/form-data for vehicle and SOAT photos
   * 
   * @param {Request} req - Express request with authenticated user
   * @param {Response} res - Express response
   * @param {NextFunction} next - Express next middleware
   */
  async createVehicle(req, res, next) {
    try {
      // TODO: Get driverId from authenticated user (req.user.id)
      // For now, we'll get it from request body for testing
      const driverId = req.body.driverId || req.user?.id;

      if (!driverId) {
        return res.status(401).json({
          code: 'unauthorized',
          message: 'Authentication required'
        });
      }

      // Extract files if multipart request
      const files = {
        vehiclePhoto: req.files?.vehiclePhoto?.[0],
        soatPhoto: req.files?.soatPhoto?.[0]
      };

      // Create vehicle DTO from request
      const createVehicleDto = CreateVehicleDto.fromMultipart(req.body, files, driverId);
      
      // Validate DTO
      createVehicleDto.validate();

      // Create vehicle through service
      const vehicle = await this.vehicleService.createVehicle(createVehicleDto);

      res.status(201).json(vehicle);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vehicles/my-vehicle
   * Get the authenticated driver's vehicle
   * 
   * @param {Request} req - Express request with authenticated user
   * @param {Response} res - Express response
   * @param {NextFunction} next - Express next middleware
   */
  async getMyVehicle(req, res, next) {
    try {
      // TODO: Get driverId from authenticated user (req.user.id)
      const driverId = req.query.driverId || req.user?.id;

      if (!driverId) {
        return res.status(401).json({
          code: 'unauthorized',
          message: 'Authentication required'
        });
      }

      const vehicle = await this.vehicleService.getVehicleByDriverId(driverId);

      if (!vehicle) {
        return res.status(404).json({
          code: 'vehicle_not_found',
          message: 'Vehicle not found for this driver'
        });
      }

      res.status(200).json(vehicle);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/vehicles/my-vehicle
   * Update the authenticated driver's vehicle
   * Supports partial updates and photo replacement
   * 
   * @param {Request} req - Express request with authenticated user
   * @param {Response} res - Express response
   * @param {NextFunction} next - Express next middleware
   */
  async updateMyVehicle(req, res, next) {
    try {
      // TODO: Get driverId from authenticated user (req.user.id)
      const driverId = req.body.driverId || req.user?.id;

      if (!driverId) {
        return res.status(401).json({
          code: 'unauthorized',
          message: 'Authentication required'
        });
      }

      // Extract files if multipart request
      const files = {
        vehiclePhoto: req.files?.vehiclePhoto?.[0],
        soatPhoto: req.files?.soatPhoto?.[0]
      };

      // Create update DTO from request
      const updateVehicleDto = UpdateVehicleDto.fromMultipart(req.body, files);
      
      // Validate DTO
      updateVehicleDto.validate();

      // Update vehicle through service
      const vehicle = await this.vehicleService.updateVehicle(driverId, updateVehicleDto);

      if (!vehicle) {
        return res.status(404).json({
          code: 'vehicle_not_found',
          message: 'Driver has no vehicle'
        });
      }

      res.status(200).json(vehicle);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/vehicles/my-vehicle
   * Delete the authenticated driver's vehicle
   * 
   * @param {Request} req - Express request with authenticated user
   * @param {Response} res - Express response
   * @param {NextFunction} next - Express next middleware
   */
  async deleteMyVehicle(req, res, next) {
    try {
      // TODO: Get driverId from authenticated user (req.user.id)
      const driverId = req.query.driverId || req.user?.id;

      if (!driverId) {
        return res.status(401).json({
          code: 'unauthorized',
          message: 'Authentication required'
        });
      }

      await this.vehicleService.deleteVehicle(driverId);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vehicles/:driverId/has-vehicle
   * Check if a driver has a vehicle (public endpoint for validation)
   * 
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   * @param {NextFunction} next - Express next middleware
   */
  async checkDriverHasVehicle(req, res, next) {
    try {
      const { driverId } = req.params;

      if (!driverId) {
        return res.status(400).json({
          code: 'invalid_request',
          message: 'Driver ID is required'
        });
      }

      const hasVehicle = await this.vehicleService.driverHasVehicle(driverId);

      res.status(200).json({
        driverId,
        hasVehicle
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = VehicleController;

