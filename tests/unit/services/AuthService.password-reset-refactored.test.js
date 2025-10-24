/**
 * Unit Tests for AuthService - Password Reset (REFACTORED for Subtask 2.3.4)
 * 
 * Tests for Subtask 2.3.1 - Request Password Reset (with PasswordResetToken collection)
 * 
 * Coverage:
 * - Password reset request logic with token repository
 * - Token generation and storage in dedicated collection
 * - User not found handling (anti-enumeration)
 * - Token invalidation (previous tokens)
 * - Metadata tracking (IP, User-Agent)
 */

const AuthService = require('../../../src/domain/services/AuthService');
const ResetTokenUtil = require('../../../src/utils/resetToken');

describe('AuthService - Password Reset (Subtask 2.3.4)', () => {
  let authService;
  let mockUserRepository;
  let mockTokenRepository;

  beforeEach(() => {
    // Mock UserRepository
    mockUserRepository = {
      findByEmail: jest.fn()
    };

    // Mock PasswordResetTokenRepository
    mockTokenRepository = {
      create: jest.fn(),
      invalidateActiveTokens: jest.fn(),
      findByHash: jest.fn(),
      consumeToken: jest.fn()
    };

    authService = new AuthService();
  });

  describe('requestPasswordReset', () => {
    it('should generate token and store in token collection when email exists', async () => {
      const testEmail = 'test@unisabana.edu.co';
      const mockUser = {
        _id: 'user123',
        id: 'user123',
        corporateEmail: testEmail,
        firstName: 'Test',
        lastName: 'User'
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      const result = await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail,
        '192.168.1.1',
        'Mozilla/5.0'
      );

      // Should return success and token
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('token');
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);

      // Should have called findByEmail
      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith(testEmail);

      // Should have invalidated previous tokens
      expect(mockTokenRepository.invalidateActiveTokens).toHaveBeenCalledWith('user123');

      // Should have created token in collection
      expect(mockTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
          createdIp: '192.168.1.1',
          createdUa: 'Mozilla/5.0'
        })
      );

      // Verify the hashed token is different from raw token
      const createCall = mockTokenRepository.create.mock.calls[0][0];
      expect(createCall.tokenHash).not.toBe(result.token);
      
      // Verify it's a proper SHA-256 hash (64 hex characters)
      expect(createCall.tokenHash).toMatch(/^[a-f0-9]{64}$/);

      // Verify token expiry is ~15 minutes in the future
      const expiresAt = createCall.expiresAt;
      const now = new Date();
      const diff = (expiresAt - now) / 1000 / 60; // difference in minutes
      expect(diff).toBeGreaterThan(14);
      expect(diff).toBeLessThan(16);
    });

    it('should invalidate previous active tokens for user', async () => {
      const testEmail = 'test@unisabana.edu.co';
      const mockUser = {
        id: 'user123',
        corporateEmail: testEmail,
        firstName: 'Test'
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(2); // 2 previous tokens
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail,
        '192.168.1.1',
        'Mozilla/5.0'
      );

      expect(mockTokenRepository.invalidateActiveTokens).toHaveBeenCalledWith('user123');
    });

    it('should return generic success when user does not exist (anti-enumeration)', async () => {
      const testEmail = 'nonexistent@unisabana.edu.co';
      
      mockUserRepository.findByEmail.mockResolvedValue(null);

      const result = await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail,
        '192.168.1.1',
        'Mozilla/5.0'
      );

      // Should return success without token (generic response)
      expect(result).toEqual({ success: true });

      // Should NOT create token or invalidate tokens
      expect(mockTokenRepository.create).not.toHaveBeenCalled();
      expect(mockTokenRepository.invalidateActiveTokens).not.toHaveBeenCalled();
    });

    it('should generate unique tokens on consecutive calls', async () => {
      const testEmail = 'test@unisabana.edu.co';
      const mockUser = {
        id: 'user123',
        corporateEmail: testEmail
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      const result1 = await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail
      );
      const result2 = await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail
      );

      // Tokens should be different
      expect(result1.token).not.toBe(result2.token);

      // Hashed tokens should also be different
      const hash1 = mockTokenRepository.create.mock.calls[0][0].tokenHash;
      const hash2 = mockTokenRepository.create.mock.calls[1][0].tokenHash;
      expect(hash1).not.toBe(hash2);
    });

    it('should store IP and User-Agent metadata with token', async () => {
      const testEmail = 'test@unisabana.edu.co';
      const mockUser = {
        id: 'user123',
        corporateEmail: testEmail
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail,
        '203.0.113.42',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'
      );

      expect(mockTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdIp: '203.0.113.42',
          createdUa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'
        })
      );
    });

    it('should use default values for missing IP/User-Agent', async () => {
      const testEmail = 'test@unisabana.edu.co';
      const mockUser = {
        id: 'user123',
        corporateEmail: testEmail
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail
      );

      expect(mockTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdIp: 'unknown',
          createdUa: 'unknown'
        })
      );
    });

    it('should normalize email to lowercase', async () => {
      const testEmail = 'TEST@UnISABana.EDU.CO';
      const mockUser = {
        id: 'user123',
        corporateEmail: 'test@unisabana.edu.co'
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail
      );

      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith('test@unisabana.edu.co');
    });

    it('should throw generic error on repository failure', async () => {
      const testEmail = 'test@unisabana.edu.co';
      const mockUser = {
        id: 'user123',
        corporateEmail: testEmail
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockRejectedValue(new Error('DB connection failed'));

      await expect(
        authService.requestPasswordReset(
          mockUserRepository,
          mockTokenRepository,
          testEmail
        )
      ).rejects.toThrow('Failed to process password reset request');
    });

    it('should not log email addresses (PII redaction)', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const testEmail = 'sensitive@unisabana.edu.co';

      mockUserRepository.findByEmail.mockResolvedValue(null);

      await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        testEmail
      );

      // Verify no log contains the full email
      consoleLogSpy.mock.calls.forEach(call => {
        const logMessage = call.join(' ');
        expect(logMessage).not.toContain(testEmail);
      });

      consoleLogSpy.mockRestore();
    });
  });

  describe('Integration with ResetTokenUtil', () => {
    it('should use generateResetToken to create token', async () => {
      const generateSpy = jest.spyOn(ResetTokenUtil, 'generateResetToken');
      
      const mockUser = {
        id: 'user123',
        corporateEmail: 'test@unisabana.edu.co'
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        'test@unisabana.edu.co'
      );

      expect(generateSpy).toHaveBeenCalledWith(15); // 15 minutes expiry
      
      generateSpy.mockRestore();
    });

    it('should return tokenPlain (not token) for email dispatch', async () => {
      const mockUser = {
        id: 'user123',
        corporateEmail: 'test@unisabana.edu.co'
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepository.invalidateActiveTokens.mockResolvedValue(0);
      mockTokenRepository.create.mockResolvedValue({ _id: 'token123' });

      const result = await authService.requestPasswordReset(
        mockUserRepository,
        mockTokenRepository,
        'test@unisabana.edu.co'
      );

      // Should return token (the plain token for email)
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      
      // Should be base64url format (no +, /, or =)
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.token.length).toBeGreaterThan(40); // ~43 characters for 32 bytes
    });
  });
});
