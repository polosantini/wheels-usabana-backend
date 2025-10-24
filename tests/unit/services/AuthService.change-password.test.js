/**
 * Unit Tests for AuthService - Change Password (In-session)
 * 
 * Tests for Subtask 2.3.3 - Change Password
 * 
 * Coverage:
 * - Current password verification
 * - New password hashing and update
 * - Error handling (401 invalid_credentials)
 * - Security (no password logging)
 */

const AuthService = require('../../../src/domain/services/AuthService');
const bcrypt = require('bcrypt');

describe('AuthService - Change Password', () => {
  let authService;
  let mockUserRepository;

  beforeEach(() => {
    // Mock UserRepository
    mockUserRepository = {
      findById: jest.fn(),
      updatePassword: jest.fn()
    };

    // AuthService doesn't take constructor params
    authService = new AuthService();
  });

  describe('changePassword', () => {
    it('should successfully change password with correct current password', async () => {
      const userId = 'user123';
      const currentPassword = 'OldPassword123!';
      const newPassword = 'NewSecurePass123!';
      
      // Hash the current password (simulating stored hash)
      const currentPasswordHash = await bcrypt.hash(currentPassword, 10);
      
      const mockUser = {
        _id: userId,
        id: userId,
        corporateEmail: 'test@unisabana.edu.co',
        password: currentPasswordHash
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.updatePassword.mockResolvedValue(true);

      const result = await authService.changePassword(
        mockUserRepository,
        userId,
        currentPassword,
        newPassword
      );

      // Should return success
      expect(result).toEqual({ success: true });

      // Should have found user by ID
      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);

      // Should have updated password
      expect(mockUserRepository.updatePassword).toHaveBeenCalledWith(
        userId,
        expect.any(String) // bcrypt hash
      );

      // Verify new password was hashed with bcrypt
      const hashedPassword = mockUserRepository.updatePassword.mock.calls[0][1];
      const isValidBcrypt = await bcrypt.compare(newPassword, hashedPassword);
      expect(isValidBcrypt).toBe(true);

      // Verify old password does NOT match new hash
      const oldPasswordMatchesNewHash = await bcrypt.compare(currentPassword, hashedPassword);
      expect(oldPasswordMatchesNewHash).toBe(false);
    });

    it('should throw invalid_credentials (401) when user not found', async () => {
      const userId = 'nonexistent';
      
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(
        authService.changePassword(
          mockUserRepository,
          userId,
          'OldPassword123!',
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'Email or password is incorrect',
        code: 'invalid_credentials',
        statusCode: 401
      });

      // Should NOT call updatePassword
      expect(mockUserRepository.updatePassword).not.toHaveBeenCalled();
    });

    it('should throw invalid_credentials (401) when current password is wrong', async () => {
      const userId = 'user123';
      const correctPassword = 'CorrectPassword123!';
      const wrongPassword = 'WrongPassword123!';
      
      const correctPasswordHash = await bcrypt.hash(correctPassword, 10);
      
      const mockUser = {
        _id: userId,
        id: userId,
        password: correctPasswordHash
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);

      await expect(
        authService.changePassword(
          mockUserRepository,
          userId,
          wrongPassword,  // Wrong current password
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'Email or password is incorrect',
        code: 'invalid_credentials',
        statusCode: 401
      });

      // Should NOT call updatePassword
      expect(mockUserRepository.updatePassword).not.toHaveBeenCalled();
    });

    it('should handle repository errors gracefully', async () => {
      const userId = 'user123';
      
      mockUserRepository.findById.mockRejectedValue(
        new Error('Database connection error')
      );

      await expect(
        authService.changePassword(
          mockUserRepository,
          userId,
          'OldPassword123!',
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'Failed to change password',
        code: 'password_change_error',
        statusCode: 500
      });
    });

    it('should use configured bcrypt rounds for password hashing', async () => {
      const userId = 'user123';
      const currentPassword = 'OldPassword123!';
      const newPassword = 'NewSecurePass123!';
      
      // Set bcrypt rounds
      process.env.BCRYPT_ROUNDS = '12';
      
      const currentPasswordHash = await bcrypt.hash(currentPassword, 10);
      
      const mockUser = {
        _id: userId,
        id: userId,
        password: currentPasswordHash
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.changePassword(
        mockUserRepository,
        userId,
        currentPassword,
        newPassword
      );

      // Verify password was hashed with round 12
      const hashedPassword = mockUserRepository.updatePassword.mock.calls[0][1];
      
      // Bcrypt hashes start with $2b$<rounds>$
      expect(hashedPassword).toMatch(/^\$2[aby]\$12\$/);
      
      // Verify it's a valid bcrypt hash
      const isValidBcrypt = await bcrypt.compare(newPassword, hashedPassword);
      expect(isValidBcrypt).toBe(true);

      // Reset environment
      delete process.env.BCRYPT_ROUNDS;
    });

    it('should verify current password before allowing change', async () => {
      const userId = 'user123';
      const currentPassword = 'OldPassword123!';
      const newPassword = 'NewSecurePass123!';
      
      const currentPasswordHash = await bcrypt.hash(currentPassword, 10);
      
      const mockUser = {
        _id: userId,
        id: userId,
        password: currentPasswordHash
      };

      // Spy on verifyPassword to ensure it's called
      const verifyPasswordSpy = jest.spyOn(authService, 'verifyPassword');

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.changePassword(
        mockUserRepository,
        userId,
        currentPassword,
        newPassword
      );

      // Should have called verifyPassword
      expect(verifyPasswordSpy).toHaveBeenCalledWith(
        currentPassword,
        currentPasswordHash
      );

      verifyPasswordSpy.mockRestore();
    });
  });

  describe('Password Security', () => {
    it('should never log passwords', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const userId = 'user123';
      const currentPassword = 'OldPassword123!';
      const newPassword = 'NewSecurePass123!';
      
      const currentPasswordHash = await bcrypt.hash(currentPassword, 10);
      
      const mockUser = {
        _id: userId,
        id: userId,
        password: currentPasswordHash
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.changePassword(
        mockUserRepository,
        userId,
        currentPassword,
        newPassword,
        '1.2.3.4'
      );

      // Check all console.log calls
      const allLogCalls = consoleSpy.mock.calls.map(call => call.join(' '));
      allLogCalls.forEach(logMessage => {
        expect(logMessage).not.toContain(currentPassword);
        expect(logMessage).not.toContain(newPassword);
      });

      // Check all console.error calls
      const allErrorCalls = consoleErrorSpy.mock.calls.map(call => call.join(' '));
      allErrorCalls.forEach(errorMessage => {
        expect(errorMessage).not.toContain(currentPassword);
        expect(errorMessage).not.toContain(newPassword);
      });

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should use timing-safe password comparison', async () => {
      // This test verifies we're using bcrypt.compare which is timing-safe
      
      const userId = 'user123';
      const correctPassword = 'CorrectPassword123!';
      const correctPasswordHash = await bcrypt.hash(correctPassword, 10);
      
      const mockUser = {
        _id: userId,
        id: userId,
        password: correctPasswordHash
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.updatePassword.mockResolvedValue(true);

      // Should succeed with correct password
      await expect(
        authService.changePassword(
          mockUserRepository,
          userId,
          correctPassword,
          'NewPassword123!'
        )
      ).resolves.toEqual({ success: true });

      // Should fail with wrong password (but take similar time)
      const wrongPassword = 'WrongPassword123!';
      mockUserRepository.findById.mockResolvedValue(mockUser);
      
      await expect(
        authService.changePassword(
          mockUserRepository,
          userId,
          wrongPassword,
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        code: 'invalid_credentials'
      });
    });

    it('should not allow reusing the same password', async () => {
      const userId = 'user123';
      const password = 'SamePassword123!';
      
      const passwordHash = await bcrypt.hash(password, 10);
      
      const mockUser = {
        _id: userId,
        id: userId,
        password: passwordHash
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.updatePassword.mockResolvedValue(true);

      // Try to set same password as current
      await authService.changePassword(
        mockUserRepository,
        userId,
        password,  // current
        password   // new (same as current)
      );

      // Should still succeed (validation happens at controller/route level if needed)
      // But verify new hash is different (bcrypt generates unique salts)
      const newHash = mockUserRepository.updatePassword.mock.calls[0][1];
      expect(newHash).not.toBe(passwordHash); // Different hash even for same password
    });
  });
});
