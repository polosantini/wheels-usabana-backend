/**
 * Unit Tests for AuthService - Reset Password (REFACTORED for Subtask 2.3.4)
 * 
 * Tests for Subtask 2.3.2 - Perform Password Reset (with PasswordResetToken collection)
 * 
 * Coverage:
 * - Token validation from dedicated collection
 * - Token consumption (idempotent marking)
 * - Password update in User collection
 * - Error codes (400, 410, 409)
 * - Security: SHA-256 lookup, no plaintext storage
 */

const AuthService = require('../../../src/domain/services/AuthService');
const ResetTokenUtil = require('../../../src/utils/resetToken');
const bcrypt = require('bcrypt');

// Mock bcrypt
jest.mock('bcrypt');

describe('AuthService - Reset Password (Subtask 2.3.4)', () => {
  let authService;
  let mockUserRepository;
  let mockTokenRepository;

  beforeEach(() => {
    // Mock UserRepository
    mockUserRepository = {
      updatePassword: jest.fn()
    };

    // Mock PasswordResetTokenRepository
    mockTokenRepository = {
      findByHash: jest.fn(),
      consumeToken: jest.fn()
    };

    authService = new AuthService();
    
    // Mock bcrypt.hash
    bcrypt.hash.mockResolvedValue('$2b$10$hashedPassword');
  });

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        _id: 'token123',
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min from now
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockTokenRepository.consumeToken.mockResolvedValue({ ...mockTokenRecord, consumedAt: new Date() });
      mockUserRepository.updatePassword.mockResolvedValue(true);

      const result = await authService.resetPassword(
        mockUserRepository,
        mockTokenRepository,
        plainToken,
        'NewPassword123!',
        '192.168.1.1'
      );

      expect(result).toEqual({ success: true });

      // Should hash the token to look it up
      expect(mockTokenRepository.findByHash).toHaveBeenCalledWith(tokenHash);

      // Should hash the new password
      expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword123!', 10);

      // Should update password in User collection
      expect(mockUserRepository.updatePassword).toHaveBeenCalledWith(
        'user123',
        '$2b$10$hashedPassword'
      );

      // Should mark token as consumed
      expect(mockTokenRepository.consumeToken).toHaveBeenCalledWith(tokenHash);
    });

    it('should throw 400 invalid_token when token not found', async () => {
      const plainToken = 'nonexistent';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);

      mockTokenRepository.findByHash.mockResolvedValue(null);

      await expect(
        authService.resetPassword(
          mockUserRepository,
          mockTokenRepository,
          plainToken,
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'The reset link is invalid',
        code: 'invalid_token',
        statusCode: 400
      });

      expect(mockTokenRepository.findByHash).toHaveBeenCalledWith(tokenHash);
      expect(mockUserRepository.updatePassword).not.toHaveBeenCalled();
      expect(mockTokenRepository.consumeToken).not.toHaveBeenCalled();
    });

    it('should throw 410 token_expired when token is expired', async () => {
      const plainToken = 'expiredtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        _id: 'token123',
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);

      await expect(
        authService.resetPassword(
          mockUserRepository,
          mockTokenRepository,
          plainToken,
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'The reset link has expired',
        code: 'token_expired',
        statusCode: 410
      });

      expect(mockUserRepository.updatePassword).not.toHaveBeenCalled();
      expect(mockTokenRepository.consumeToken).not.toHaveBeenCalled();
    });

    it('should throw 409 token_used when token already consumed', async () => {
      const plainToken = 'usedtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        _id: 'token123',
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: new Date(Date.now() - 5 * 60 * 1000) // consumed 5 min ago
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);

      await expect(
        authService.resetPassword(
          mockUserRepository,
          mockTokenRepository,
          plainToken,
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'The reset link has already been used',
        code: 'token_used',
        statusCode: 409
      });

      expect(mockUserRepository.updatePassword).not.toHaveBeenCalled();
      expect(mockTokenRepository.consumeToken).not.toHaveBeenCalled();
    });

    it('should use configurable bcrypt rounds from environment', async () => {
      process.env.BCRYPT_ROUNDS = '12';

      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockTokenRepository.consumeToken.mockResolvedValue({ ...mockTokenRecord, consumedAt: new Date() });
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.resetPassword(
        mockUserRepository,
        mockTokenRepository,
        plainToken,
        'NewPassword123!'
      );

      expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword123!', 12);

      delete process.env.BCRYPT_ROUNDS;
    });

    it('should default to 10 bcrypt rounds if not configured', async () => {
      delete process.env.BCRYPT_ROUNDS;

      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockTokenRepository.consumeToken.mockResolvedValue({ ...mockTokenRecord, consumedAt: new Date() });
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.resetPassword(
        mockUserRepository,
        mockTokenRepository,
        plainToken,
        'NewPassword123!'
      );

      expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword123!', 10);
    });

    it('should not log passwords or tokens', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      const newPassword = 'SuperSecret123!';
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockTokenRepository.consumeToken.mockResolvedValue({ ...mockTokenRecord, consumedAt: new Date() });
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.resetPassword(
        mockUserRepository,
        mockTokenRepository,
        plainToken,
        newPassword,
        '192.168.1.1'
      );

      // Verify no log contains password or token
      const allLogs = [
        ...consoleLogSpy.mock.calls,
        ...consoleErrorSpy.mock.calls
      ];

      allLogs.forEach(call => {
        const logMessage = call.join(' ');
        expect(logMessage).not.toContain(plainToken);
        expect(logMessage).not.toContain(newPassword);
        expect(logMessage).not.toContain(tokenHash);
      });

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should throw generic error on repository failure', async () => {
      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockUserRepository.updatePassword.mockRejectedValue(new Error('DB connection failed'));

      await expect(
        authService.resetPassword(
          mockUserRepository,
          mockTokenRepository,
          plainToken,
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'Failed to reset password',
        code: 'password_reset_error',
        statusCode: 500
      });
    });

    it('should handle missing expiresAt field', async () => {
      const plainToken = 'abc123';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: null, // Missing expiry
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);

      await expect(
        authService.resetPassword(
          mockUserRepository,
          mockTokenRepository,
          plainToken,
          'NewPassword123!'
        )
      ).rejects.toMatchObject({
        message: 'The reset link has expired',
        code: 'token_expired',
        statusCode: 410
      });
    });

    it('should consume token atomically (call consumeToken)', async () => {
      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockTokenRepository.consumeToken.mockResolvedValue({ ...mockTokenRecord, consumedAt: new Date() });
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.resetPassword(
        mockUserRepository,
        mockTokenRepository,
        plainToken,
        'NewPassword123!'
      );

      // Verify consumeToken was called (idempotent marking)
      expect(mockTokenRepository.consumeToken).toHaveBeenCalledWith(tokenHash);
    });

    it('should update password first, then consume token', async () => {
      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: null
      };

      const callOrder = [];
      
      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockUserRepository.updatePassword.mockImplementation(() => {
        callOrder.push('updatePassword');
        return Promise.resolve(true);
      });
      mockTokenRepository.consumeToken.mockImplementation(() => {
        callOrder.push('consumeToken');
        return Promise.resolve({ ...mockTokenRecord, consumedAt: new Date() });
      });

      await authService.resetPassword(
        mockUserRepository,
        mockTokenRepository,
        plainToken,
        'NewPassword123!'
      );

      // Verify order: password update before token consumption
      expect(callOrder).toEqual(['updatePassword', 'consumeToken']);
    });
  });

  describe('Security', () => {
    it('should use SHA-256 hash for token lookup (not plaintext)', async () => {
      const plainToken = 'mySecretToken123';
      const expectedHash = ResetTokenUtil.hashToken(plainToken);

      mockTokenRepository.findByHash.mockResolvedValue(null);

      await expect(
        authService.resetPassword(
          mockUserRepository,
          mockTokenRepository,
          plainToken,
          'NewPassword123!'
        )
      ).rejects.toThrow();

      // Should look up by hash, not plaintext
      expect(mockTokenRepository.findByHash).toHaveBeenCalledWith(expectedHash);
      expect(mockTokenRepository.findByHash).not.toHaveBeenCalledWith(plainToken);
    });

    it('should never store plaintext passwords', async () => {
      const plainToken = 'abc123validtoken';
      const tokenHash = ResetTokenUtil.hashToken(plainToken);
      
      const mockTokenRecord = {
        userId: 'user123',
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        consumedAt: null
      };

      mockTokenRepository.findByHash.mockResolvedValue(mockTokenRecord);
      mockTokenRepository.consumeToken.mockResolvedValue({ ...mockTokenRecord, consumedAt: new Date() });
      mockUserRepository.updatePassword.mockResolvedValue(true);

      await authService.resetPassword(
        mockUserRepository,
        mockTokenRepository,
        plainToken,
        'NewPassword123!'
      );

      // Should update with hashed password only
      const updateCall = mockUserRepository.updatePassword.mock.calls[0];
      expect(updateCall[1]).not.toBe('NewPassword123!'); // Not plaintext
      expect(updateCall[1]).toMatch(/^\$2b\$/); // Bcrypt hash format
    });
  });
});
