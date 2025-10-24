/**
 * Unit Tests for VehicleService
 * Tests business logic and invariants
 */

const VehicleService = require('../../../src/domain/services/VehicleService');
const CreateVehicleDto = require('../../../src/domain/dtos/CreateVehicleDto');
const UpdateVehicleDto = require('../../../src/domain/dtos/UpdateVehicleDto');
const OneVehicleRuleError = require('../../../src/domain/errors/OneVehicleRuleError');
const DuplicatePlateError = require('../../../src/domain/errors/DuplicatePlateError');

describe('VehicleService', () => {
  let vehicleService;
  let mockRepository;

  beforeEach(() => {
    // Mock repository
    mockRepository = {
      create: jest.fn(),
      findByDriverId: jest.fn(),
      updateByDriverId: jest.fn(),
      deleteByDriverId: jest.fn(),
      driverHasVehicle: jest.fn(),
      plateExists: jest.fn()
    };

    vehicleService = new VehicleService();
    vehicleService.vehicleRepository = mockRepository;
  });

  describe('createVehicle', () => {
    it('should create vehicle when driver has no vehicle and plate is unique', async () => {
      // Arrange
      const dto = new CreateVehicleDto({
        driverId: '507f1f77bcf86cd799439011',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        capacity: 4
      });

      mockRepository.driverHasVehicle.mockResolvedValue(false);
      mockRepository.plateExists.mockResolvedValue(false);
      mockRepository.create.mockResolvedValue({
        id: '507f1f77bcf86cd799439012',
        driverId: dto.driverId,
        plate: dto.plate,
        brand: dto.brand,
        model: dto.model,
        capacity: dto.capacity,
        vehiclePhotoUrl: null,
        soatPhotoUrl: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Act
      const result = await vehicleService.createVehicle(dto);

      // Assert
      expect(result).toBeDefined();
      expect(result.plate).toBe('ABC123');
      expect(mockRepository.driverHasVehicle).toHaveBeenCalledWith(dto.driverId);
      expect(mockRepository.plateExists).toHaveBeenCalledWith(dto.plate);
      expect(mockRepository.create).toHaveBeenCalled();
    });

    it('should throw OneVehicleRuleError when driver already has a vehicle', async () => {
      // Arrange
      const dto = new CreateVehicleDto({
        driverId: '507f1f77bcf86cd799439011',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        capacity: 4
      });

      mockRepository.driverHasVehicle.mockResolvedValue(true);

      // Act & Assert
      await expect(vehicleService.createVehicle(dto))
        .rejects
        .toThrow(OneVehicleRuleError);

      expect(mockRepository.driverHasVehicle).toHaveBeenCalledWith(dto.driverId);
      expect(mockRepository.plateExists).not.toHaveBeenCalled();
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should throw DuplicatePlateError when plate already exists', async () => {
      // Arrange
      const dto = new CreateVehicleDto({
        driverId: '507f1f77bcf86cd799439011',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        capacity: 4
      });

      mockRepository.driverHasVehicle.mockResolvedValue(false);
      mockRepository.plateExists.mockResolvedValue(true);

      // Act & Assert
      await expect(vehicleService.createVehicle(dto))
        .rejects
        .toThrow(DuplicatePlateError);

      expect(mockRepository.driverHasVehicle).toHaveBeenCalledWith(dto.driverId);
      expect(mockRepository.plateExists).toHaveBeenCalledWith(dto.plate);
      expect(mockRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('updateVehicle', () => {
    it('should update vehicle when it exists', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      const dto = new UpdateVehicleDto({
        brand: 'Honda',
        model: 'Civic'
      });

      const existingVehicle = {
        id: '507f1f77bcf86cd799439012',
        driverId,
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        capacity: 4,
        vehiclePhotoUrl: null,
        soatPhotoUrl: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockRepository.findByDriverId.mockResolvedValue(existingVehicle);
      mockRepository.updateByDriverId.mockResolvedValue({
        ...existingVehicle,
        brand: 'Honda',
        model: 'Civic'
      });

      // Act
      const result = await vehicleService.updateVehicle(driverId, dto);

      // Assert
      expect(result).toBeDefined();
      expect(result.brand).toBe('Honda');
      expect(result.model).toBe('Civic');
      expect(mockRepository.findByDriverId).toHaveBeenCalledWith(driverId);
      expect(mockRepository.updateByDriverId).toHaveBeenCalled();
    });

    it('should return null when vehicle does not exist', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      const dto = new UpdateVehicleDto({
        brand: 'Honda'
      });

      mockRepository.findByDriverId.mockResolvedValue(null);

      // Act
      const result = await vehicleService.updateVehicle(driverId, dto);

      // Assert
      expect(result).toBeNull();
      expect(mockRepository.findByDriverId).toHaveBeenCalledWith(driverId);
      expect(mockRepository.updateByDriverId).not.toHaveBeenCalled();
    });
  });

  describe('getVehicleByDriverId', () => {
    it('should return vehicle when it exists', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      const vehicle = {
        id: '507f1f77bcf86cd799439012',
        driverId,
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        capacity: 4,
        vehiclePhotoUrl: null,
        soatPhotoUrl: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockRepository.findByDriverId.mockResolvedValue(vehicle);

      // Act
      const result = await vehicleService.getVehicleByDriverId(driverId);

      // Assert
      expect(result).toBeDefined();
      expect(result.plate).toBe('ABC123');
    });

    it('should return null when vehicle does not exist', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      mockRepository.findByDriverId.mockResolvedValue(null);

      // Act
      const result = await vehicleService.getVehicleByDriverId(driverId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('deleteVehicle', () => {
    it('should delete vehicle successfully', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      const vehicle = {
        id: '507f1f77bcf86cd799439012',
        driverId,
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        capacity: 4,
        vehiclePhotoUrl: null,
        soatPhotoUrl: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockRepository.findByDriverId.mockResolvedValue(vehicle);
      mockRepository.deleteByDriverId.mockResolvedValue(true);

      // Act
      const result = await vehicleService.deleteVehicle(driverId);

      // Assert
      expect(result).toBe(true);
      expect(mockRepository.findByDriverId).toHaveBeenCalledWith(driverId);
      expect(mockRepository.deleteByDriverId).toHaveBeenCalledWith(driverId);
    });

    it('should return false when vehicle does not exist', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      mockRepository.findByDriverId.mockResolvedValue(null);

      // Act
      const result = await vehicleService.deleteVehicle(driverId);

      // Assert
      expect(result).toBe(false);
      expect(mockRepository.findByDriverId).toHaveBeenCalledWith(driverId);
      expect(mockRepository.deleteByDriverId).not.toHaveBeenCalled();
    });
  });

  describe('driverHasVehicle', () => {
    it('should return true when driver has vehicle', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      mockRepository.driverHasVehicle.mockResolvedValue(true);

      // Act
      const result = await vehicleService.driverHasVehicle(driverId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when driver has no vehicle', async () => {
      // Arrange
      const driverId = '507f1f77bcf86cd799439011';
      mockRepository.driverHasVehicle.mockResolvedValue(false);

      // Act
      const result = await vehicleService.driverHasVehicle(driverId);

      // Assert
      expect(result).toBe(false);
    });
  });
});

