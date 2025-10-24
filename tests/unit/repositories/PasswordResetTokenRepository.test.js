/**
 * Unit Tests: PasswordResetTokenRepository
 * 
 * Tests MongoDB implementation of password reset token operations:
 * - Token creation with metadata
 * - Token lookup (by hash, valid only)
 * - Token consumption (idempotent)
 * - Invalidate all user tokens
 * - Cleanup expired tokens
 * - Count active tokens
 */

const MongoPasswordResetTokenRepository = require('../../../src/infrastructure/repositories/PasswordResetTokenRepository');
const PasswordResetTokenModel = require('../../../src/infrastructure/database/models/PasswordResetTokenModel');

// Mock Mongoose model
jest.mock('../../../src/infrastructure/database/models/PasswordResetTokenModel');

describe('PasswordResetTokenRepository', () => {
  let repository;

  beforeEach(() => {
    repository = new MongoPasswordResetTokenRepository();
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create token with all metadata', async () => {
      const tokenData = {
        userId: '665e2af1',
        tokenHash: 'abc123hash',
        expiresAt: new Date('2025-10-22T12:00:00Z'),
        createdIp: '192.168.1.1',
        createdUa: 'Mozilla/5.0'
      };

      const mockToken = { ...tokenData, _id: 'token123', save: jest.fn().mockResolvedValue() };
      PasswordResetTokenModel.mockImplementation(() => mockToken);

      const result = await repository.create(tokenData);

      expect(PasswordResetTokenModel).toHaveBeenCalledWith(tokenData);
      expect(mockToken.save).toHaveBeenCalled();
      expect(result).toBe(mockToken);
    });

    it('should create token with null metadata if not provided', async () => {
      const tokenData = {
        userId: '665e2af1',
        tokenHash: 'abc123hash',
        expiresAt: new Date('2025-10-22T12:00:00Z')
      };

      const mockToken = { 
        ...tokenData, 
        createdIp: null, 
        createdUa: null,
        save: jest.fn().mockResolvedValue() 
      };
      PasswordResetTokenModel.mockImplementation(() => mockToken);

      await repository.create(tokenData);

      expect(PasswordResetTokenModel).toHaveBeenCalledWith({
        ...tokenData,
        createdIp: null,
        createdUa: null
      });
    });

    it('should throw error on database failure', async () => {
      const mockToken = { save: jest.fn().mockRejectedValue(new Error('DB error')) };
      PasswordResetTokenModel.mockImplementation(() => mockToken);

      await expect(repository.create({
        userId: '665e2af1',
        tokenHash: 'abc123',
        expiresAt: new Date()
      })).rejects.toThrow('DB error');
    });
  });

  describe('findByHash', () => {
    it('should find token by hash', async () => {
      const mockToken = {
        _id: 'token123',
        userId: '665e2af1',
        tokenHash: 'abc123hash',
        expiresAt: new Date('2025-10-22T12:00:00Z'),
        consumedAt: null
      };

      PasswordResetTokenModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockToken)
      });

      const result = await repository.findByHash('abc123hash');

      expect(PasswordResetTokenModel.findOne).toHaveBeenCalledWith({ tokenHash: 'abc123hash' });
      expect(result).toEqual(mockToken);
    });

    it('should return null if token not found', async () => {
      PasswordResetTokenModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await repository.findByHash('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findValidToken', () => {
    it('should find unexpired and unconsumed token', async () => {
      const now = new Date();
      const future = new Date(now.getTime() + 15 * 60 * 1000); // 15 min from now

      const mockToken = {
        _id: 'token123',
        userId: '665e2af1',
        tokenHash: 'abc123hash',
        expiresAt: future,
        consumedAt: null
      };

      PasswordResetTokenModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockToken)
      });

      const result = await repository.findValidToken('abc123hash');

      expect(PasswordResetTokenModel.findOne).toHaveBeenCalledWith({
        tokenHash: 'abc123hash',
        expiresAt: { $gt: expect.any(Date) },
        consumedAt: null
      });
      expect(result).toEqual(mockToken);
    });

    it('should return null for expired token', async () => {
      PasswordResetTokenModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await repository.findValidToken('expired_hash');

      expect(result).toBeNull();
    });

    it('should return null for consumed token', async () => {
      PasswordResetTokenModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await repository.findValidToken('consumed_hash');

      expect(result).toBeNull();
    });
  });

  describe('consumeToken', () => {
    it('should mark token as consumed with timestamp', async () => {
      const mockToken = {
        _id: 'token123',
        tokenHash: 'abc123hash',
        consumedAt: expect.any(Date)
      };

      PasswordResetTokenModel.findOneAndUpdate = jest.fn().mockResolvedValue(mockToken);

      const result = await repository.consumeToken('abc123hash');

      expect(PasswordResetTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tokenHash: 'abc123hash', consumedAt: null },
        { $set: { consumedAt: expect.any(Date) } },
        { new: true, runValidators: false }
      );
      expect(result).toEqual(mockToken);
    });

    it('should be idempotent (no update if already consumed)', async () => {
      PasswordResetTokenModel.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      const result = await repository.consumeToken('abc123hash');

      expect(PasswordResetTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tokenHash: 'abc123hash', consumedAt: null },
        { $set: { consumedAt: expect.any(Date) } },
        { new: true, runValidators: false }
      );
      expect(result).toBeNull();
    });
  });

  describe('invalidateActiveTokens', () => {
    it('should mark all active tokens as consumed for user', async () => {
      PasswordResetTokenModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });

      const count = await repository.invalidateActiveTokens('665e2af1');

      expect(PasswordResetTokenModel.updateMany).toHaveBeenCalledWith(
        {
          userId: '665e2af1',
          expiresAt: { $gt: expect.any(Date) },
          consumedAt: null
        },
        { $set: { consumedAt: expect.any(Date) } }
      );
      expect(count).toBe(3);
    });

    it('should return 0 if no active tokens exist', async () => {
      PasswordResetTokenModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });

      const count = await repository.invalidateActiveTokens('665e2af1');

      expect(count).toBe(0);
    });
  });

  describe('countActiveForUser', () => {
    it('should count unexpired and unconsumed tokens', async () => {
      PasswordResetTokenModel.countDocuments = jest.fn().mockResolvedValue(2);

      const count = await repository.countActiveForUser('665e2af1');

      expect(PasswordResetTokenModel.countDocuments).toHaveBeenCalledWith({
        userId: '665e2af1',
        expiresAt: { $gt: expect.any(Date) },
        consumedAt: null
      });
      expect(count).toBe(2);
    });

    it('should return 0 if no active tokens', async () => {
      PasswordResetTokenModel.countDocuments = jest.fn().mockResolvedValue(0);

      const count = await repository.countActiveForUser('665e2af1');

      expect(count).toBe(0);
    });
  });

  describe('cleanupExpired', () => {
    it('should delete all expired tokens', async () => {
      PasswordResetTokenModel.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 5 });

      const count = await repository.cleanupExpired();

      expect(PasswordResetTokenModel.deleteMany).toHaveBeenCalledWith({
        expiresAt: { $lt: expect.any(Date) }
      });
      expect(count).toBe(5);
    });

    it('should return 0 if no expired tokens', async () => {
      PasswordResetTokenModel.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });

      const count = await repository.cleanupExpired();

      expect(count).toBe(0);
    });
  });

  describe('findByUserId', () => {
    it('should return all tokens for user sorted by creation date', async () => {
      const mockTokens = [
        { _id: 'token2', userId: '665e2af1', createdAt: new Date('2025-10-22T12:00:00Z') },
        { _id: 'token1', userId: '665e2af1', createdAt: new Date('2025-10-22T11:00:00Z') }
      ];

      PasswordResetTokenModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockTokens)
        })
      });

      const result = await repository.findByUserId('665e2af1');

      expect(PasswordResetTokenModel.find).toHaveBeenCalledWith({ userId: '665e2af1' });
      expect(result).toEqual(mockTokens);
    });

    it('should return empty array if user has no tokens', async () => {
      PasswordResetTokenModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const result = await repository.findByUserId('665e2af1');

      expect(result).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should throw and log errors from database', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      PasswordResetTokenModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('Connection failed'))
      });

      await expect(repository.findByHash('abc123')).rejects.toThrow('Connection failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[PasswordResetTokenRepository] FindByHash failed:',
        'Connection failed'
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
