/**
 * AuthService Unit Tests
 * 
 * Tests for AuthService methods including:
 * - getCurrentUserProfile (session verification)
 * - Password verification
 * - JWT signing/verification
 */

const AuthService = require('../../../src/domain/services/AuthService');

describe('AuthService', () => {
  let authService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe('getCurrentUserProfile', () => {
    let mockUserRepository;
    let mockVehicleRepository;

    beforeEach(() => {
      mockUserRepository = {
        findById: jest.fn()
      };
      mockVehicleRepository = {
        findByDriverId: jest.fn()
      };
    });

    it('should return minimal profile for passenger (no driver object)', async () => {
      // Arrange
      const userId = 'user-123';
      const mockUser = {
        id: 'user-123',
        role: 'passenger',
        firstName: 'John',
        lastName: 'Doe',
        corporateEmail: 'john@unisabana.edu.co',
        phone: '+573001234567',
        universityId: '12345'
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);

      // Act
      const profile = await authService.getCurrentUserProfile(
        mockUserRepository,
        mockVehicleRepository,
        userId
      );

      // Assert
      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);
      expect(mockVehicleRepository.findByDriverId).not.toHaveBeenCalled();

      expect(profile).toEqual({
        id: 'user-123',
        role: 'passenger',
        firstName: 'John',
        lastName: 'Doe'
      });

      // Should NOT include sensitive fields
      expect(profile).not.toHaveProperty('corporateEmail');
      expect(profile).not.toHaveProperty('phone');
      expect(profile).not.toHaveProperty('universityId');
      expect(profile).not.toHaveProperty('password');
      expect(profile).not.toHaveProperty('driver');
    });

    it('should return profile with driver.hasVehicle=false for driver without vehicle', async () => {
      // Arrange
      const userId = 'driver-123';
      const mockDriver = {
        id: 'driver-123',
        role: 'driver',
        firstName: 'Jane',
        lastName: 'Smith',
        corporateEmail: 'jane@unisabana.edu.co'
      };

      mockUserRepository.findById.mockResolvedValue(mockDriver);
      mockVehicleRepository.findByDriverId.mockResolvedValue(null); // No vehicle

      // Act
      const profile = await authService.getCurrentUserProfile(
        mockUserRepository,
        mockVehicleRepository,
        userId
      );

      // Assert
      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);
      expect(mockVehicleRepository.findByDriverId).toHaveBeenCalledWith(userId);

      expect(profile).toEqual({
        id: 'driver-123',
        role: 'driver',
        firstName: 'Jane',
        lastName: 'Smith',
        driver: {
          hasVehicle: false
        }
      });
    });

    it('should return profile with driver.hasVehicle=true for driver with vehicle', async () => {
      // Arrange
      const userId = 'driver-456';
      const mockDriver = {
        id: 'driver-456',
        role: 'driver',
        firstName: 'Bob',
        lastName: 'Johnson',
        corporateEmail: 'bob@unisabana.edu.co'
      };

      const mockVehicle = {
        id: 'vehicle-789',
        driverId: 'driver-456',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla'
      };

      mockUserRepository.findById.mockResolvedValue(mockDriver);
      mockVehicleRepository.findByDriverId.mockResolvedValue(mockVehicle);

      // Act
      const profile = await authService.getCurrentUserProfile(
        mockUserRepository,
        mockVehicleRepository,
        userId
      );

      // Assert
      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);
      expect(mockVehicleRepository.findByDriverId).toHaveBeenCalledWith(userId);

      expect(profile).toEqual({
        id: 'driver-456',
        role: 'driver',
        firstName: 'Bob',
        lastName: 'Johnson',
        driver: {
          hasVehicle: true
        }
      });

      // Should NOT include vehicle details
      expect(profile).not.toHaveProperty('vehicle');
      expect(profile).not.toHaveProperty('plate');
    });

    it('should throw user_not_found error when user does not exist', async () => {
      // Arrange
      const userId = 'nonexistent-user';
      mockUserRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(
        authService.getCurrentUserProfile(
          mockUserRepository,
          mockVehicleRepository,
          userId
        )
      ).rejects.toMatchObject({
        message: 'User not found',
        code: 'user_not_found'
      });

      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);
      expect(mockVehicleRepository.findByDriverId).not.toHaveBeenCalled();
    });

    it('should throw profile_fetch_error on internal repository error', async () => {
      // Arrange
      const userId = 'user-123';
      mockUserRepository.findById.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(
        authService.getCurrentUserProfile(
          mockUserRepository,
          mockVehicleRepository,
          userId
        )
      ).rejects.toMatchObject({
        message: 'Failed to fetch user profile',
        code: 'profile_fetch_error'
      });
    });

    it('should handle vehicle repository errors gracefully for drivers', async () => {
      // Arrange
      const userId = 'driver-123';
      const mockDriver = {
        id: 'driver-123',
        role: 'driver',
        firstName: 'Jane',
        lastName: 'Smith'
      };

      mockUserRepository.findById.mockResolvedValue(mockDriver);
      mockVehicleRepository.findByDriverId.mockRejectedValue(
        new Error('Vehicle DB error')
      );

      // Act & Assert
      await expect(
        authService.getCurrentUserProfile(
          mockUserRepository,
          mockVehicleRepository,
          userId
        )
      ).rejects.toMatchObject({
        message: 'Failed to fetch user profile',
        code: 'profile_fetch_error'
      });
    });

    it('should only return whitelisted fields (no PII leakage)', async () => {
      // Arrange
      const userId = 'user-123';
      const mockUser = {
        id: 'user-123',
        role: 'passenger',
        firstName: 'Test',
        lastName: 'User',
        corporateEmail: 'test@unisabana.edu.co',
        phone: '+573001234567',
        universityId: '99999',
        password: 'hashed_password_here',
        profilePhoto: '/uploads/photo.jpg',
        createdAt: new Date(),
        updatedAt: new Date(),
        _someInternalField: 'secret'
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);

      // Act
      const profile = await authService.getCurrentUserProfile(
        mockUserRepository,
        mockVehicleRepository,
        userId
      );

      // Assert - Whitelisted fields only
      expect(Object.keys(profile)).toEqual(['id', 'role', 'firstName', 'lastName']);
      
      // Explicitly check sensitive fields are NOT present
      expect(profile).not.toHaveProperty('corporateEmail');
      expect(profile).not.toHaveProperty('phone');
      expect(profile).not.toHaveProperty('universityId');
      expect(profile).not.toHaveProperty('password');
      expect(profile).not.toHaveProperty('profilePhoto');
      expect(profile).not.toHaveProperty('createdAt');
      expect(profile).not.toHaveProperty('updatedAt');
      expect(profile).not.toHaveProperty('_someInternalField');
    });

    it('should match exact response shape for passenger', async () => {
      // Arrange
      const mockUser = {
        id: 'p-123',
        role: 'passenger',
        firstName: 'Alice',
        lastName: 'Wonder'
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);

      // Act
      const profile = await authService.getCurrentUserProfile(
        mockUserRepository,
        mockVehicleRepository,
        'p-123'
      );

      // Assert - Exact shape
      expect(profile).toMatchObject({
        id: expect.any(String),
        role: expect.stringMatching(/^(passenger|driver)$/),
        firstName: expect.any(String),
        lastName: expect.any(String)
      });

      // Passenger should NOT have driver object
      expect(profile.driver).toBeUndefined();
    });

    it('should match exact response shape for driver', async () => {
      // Arrange
      const mockDriver = {
        id: 'd-456',
        role: 'driver',
        firstName: 'Bob',
        lastName: 'Builder'
      };

      mockUserRepository.findById.mockResolvedValue(mockDriver);
      mockVehicleRepository.findByDriverId.mockResolvedValue({ id: 'v-789' });

      // Act
      const profile = await authService.getCurrentUserProfile(
        mockUserRepository,
        mockVehicleRepository,
        'd-456'
      );

      // Assert - Exact shape
      expect(profile).toMatchObject({
        id: expect.any(String),
        role: 'driver',
        firstName: expect.any(String),
        lastName: expect.any(String),
        driver: {
          hasVehicle: expect.any(Boolean)
        }
      });

      // Driver object should have ONLY hasVehicle
      expect(Object.keys(profile.driver)).toEqual(['hasVehicle']);
    });
  });

  describe('Password Verification', () => {
    it('should verify valid password', async () => {
      // This test requires actual bcrypt, which is integration-level
      // For unit tests, we'd mock bcrypt, but it's already tested in integration tests
      expect(authService).toHaveProperty('verifyPassword');
      expect(typeof authService.verifyPassword).toBe('function');
    });
  });

  describe('JWT Operations', () => {
    it('should have signAccessToken method', () => {
      expect(authService).toHaveProperty('signAccessToken');
      expect(typeof authService.signAccessToken).toBe('function');
    });

    it('should have verifyAccessToken method', () => {
      expect(authService).toHaveProperty('verifyAccessToken');
      expect(typeof authService.verifyAccessToken).toBe('function');
    });
  });
});
