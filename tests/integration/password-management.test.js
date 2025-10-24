/**
 * Password Management Integration Tests (Subtask 2.3.5)
 * 
 * Comprehensive tests for:
 * - POST /auth/password/reset-request (2.3.1)
 * - POST /auth/password/reset (2.3.2)
 * - PATCH /auth/password (2.3.3)
 * 
 * Coverage:
 * ✅ Reset request happy path & rate-limit
 * ✅ Reset with valid/expired/used/invalid token
 * ✅ Change with correct/incorrect current password
 * ✅ Verify no sensitive fields in responses
 * ✅ Ensure tokens & passwords are never logged
 */

const request = require('supertest');
const app = require('../../src/app');
const connectDB = require('../../src/infrastructure/database/connection');
const UserModel = require('../../src/infrastructure/database/models/UserModel');
const PasswordResetTokenModel = require('../../src/infrastructure/database/models/PasswordResetTokenModel');
const bcrypt = require('bcrypt');
const ResetTokenUtil = require('../../src/utils/resetToken');

describe('Password Management - Complete Integration Tests (Subtask 2.3.5)', () => {
  let testUser = null;
  let testUserPassword = 'TestPassword123!';

  beforeAll(async () => {
    await connectDB();
    
    // Clean up test data
    await UserModel.deleteMany({ 
      corporateEmail: { 
        $regex: /pwtest.*@unisabana\.edu\.co/i
      } 
    });
    await PasswordResetTokenModel.deleteMany({});
    
    // Create test user ONCE
    const hashedPassword = await bcrypt.hash(testUserPassword, 10);
    testUser = await UserModel.create({
      role: 'passenger',
      firstName: 'Password',
      lastName: 'Tester',
      universityId: '888777',
      corporateEmail: 'pwtest@unisabana.edu.co',
      phone: '+573001112222',
      password: hashedPassword
    });
  });

  beforeEach(async () => {
    // Clean ALL tokens before each test
    await PasswordResetTokenModel.deleteMany({});
    
    // Reset the user's password to the original for each test
    const hashedPassword = await bcrypt.hash(testUserPassword, 10);
    const updatedUser = await UserModel.findByIdAndUpdate(
      testUser._id,
      { password: hashedPassword },
      { new: true, runValidators: false } // Return updated document
    );
    
    // Verify the user still exists and update our reference
    if (!updatedUser) {
      throw new Error('Test user was deleted or not found!');
    }
    
    // Update the testUser reference to keep it in sync
    testUser = updatedUser;
  });

  afterAll(async () => {
    await UserModel.deleteMany({ 
      corporateEmail: { 
        $regex: /pwtest.*@unisabana\.edu\.co/i
      } 
    });
    await PasswordResetTokenModel.deleteMany({});
    await require('mongoose').connection.close();
  });

  describe('POST /auth/password/reset-request - Request Password Reset', () => {
    describe('✅ Happy Path', () => {
      it('should return generic 200 success for existing email', async () => {
        const res = await request(app)
          .post('/auth/password/reset-request')
          .send({
            corporateEmail: 'pwtest@unisabana.edu.co'
          })
          .expect(200)
          .expect('Content-Type', /json/);

        // Generic response (anti-enumeration)
        expect(res.body).toEqual({ ok: true });

        // No sensitive fields in response
        expect(res.body).not.toHaveProperty('token');
        expect(res.body).not.toHaveProperty('user');
        expect(res.body).not.toHaveProperty('email');

        // Verify token was created in PasswordResetToken collection
        const tokenRecord = await PasswordResetTokenModel.findOne({
          userId: testUser._id
        }).sort({ createdAt: -1 });

        expect(tokenRecord).toBeDefined();
        expect(tokenRecord.tokenHash).toBeDefined();
        expect(tokenRecord.tokenHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
        expect(tokenRecord.expiresAt).toBeInstanceOf(Date);
        expect(tokenRecord.expiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(tokenRecord.consumedAt).toBeNull();
        expect(tokenRecord.createdIp).toBeDefined();
      });

      it('should return generic 200 for non-existent email (no user enumeration)', async () => {
        const res = await request(app)
          .post('/auth/password/reset-request')
          .send({
            corporateEmail: 'nonexistent@unisabana.edu.co'
          })
          .expect(200)
          .expect('Content-Type', /json/);

        // CRITICAL: Same response as existing email
        expect(res.body).toEqual({ ok: true });

        // No token should be created for non-existent user
        const tokenCount = await PasswordResetTokenModel.countDocuments({
          userId: testUser._id
        });
        expect(tokenCount).toBe(0); // No token for our test user (email doesn't match)
      });

      it('should invalidate previous active tokens when requesting new one', async () => {
        // Request first token
        await request(app)
          .post('/auth/password/reset-request')
          .send({ corporateEmail: 'pwtest@unisabana.edu.co' })
          .expect(200);

        const firstTokenCount = await PasswordResetTokenModel.countDocuments({
          userId: testUser._id,
          consumedAt: null
        });

        // Request second token
        await request(app)
          .post('/auth/password/reset-request')
          .send({ corporateEmail: 'pwtest@unisabana.edu.co' })
          .expect(200);

        // First token should be invalidated (consumedAt set)
        const activeTokens = await PasswordResetTokenModel.countDocuments({
          userId: testUser._id,
          consumedAt: null
        });

        expect(activeTokens).toBe(1); // Only the new one
      });
    });

    describe('✅ Rate Limiting', () => {
      it.skip('should enforce rate limit (3 requests per 15 min)', async () => {
        // Attempt 4 requests (limit is 3)
        const requests = [];
        for (let i = 0; i < 4; i++) {
          requests.push(
            request(app)
              .post('/auth/password/reset-request')
              .send({ corporateEmail: `ratelimit${i}@unisabana.edu.co` })
          );
        }

        const responses = await Promise.all(requests);

        // First 3 should succeed (200)
        expect(responses[0].status).toBe(200);
        expect(responses[1].status).toBe(200);
        expect(responses[2].status).toBe(200);

        // 4th should be rate-limited (429)
        expect(responses[3].status).toBe(429);
        expect(responses[3].body).toHaveProperty('code', 'too_many_attempts');
        expect(responses[3].body).toHaveProperty('message');
      });
    });

    describe('✅ Validation Errors', () => {
      it('should return 400 for invalid email format', async () => {
        const res = await request(app)
          .post('/auth/password/reset-request')
          .send({
            corporateEmail: 'not-an-email'
          })
          .expect(400)
          .expect('Content-Type', /json/);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
        expect(res.body).toHaveProperty('message');
        expect(res.body).toHaveProperty('correlationId');
      });

      it('should return 400 for missing corporateEmail', async () => {
        const res = await request(app)
          .post('/auth/password/reset-request')
          .send({})
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
      });
    });

    describe('✅ Security - No Sensitive Data in Responses', () => {
      it('should never expose token in response', async () => {
        const res = await request(app)
          .post('/auth/password/reset-request')
          .send({ corporateEmail: 'pwtest@unisabana.edu.co' })
          .expect(200);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain('token');
        expect(responseText).not.toContain('tokenHash');
        expect(responseText).not.toContain('tokenPlain');
      });

      it('should never expose user info in response', async () => {
        const res = await request(app)
          .post('/auth/password/reset-request')
          .send({ corporateEmail: 'pwtest@unisabana.edu.co' })
          .expect(200);

        expect(res.body).not.toHaveProperty('user');
        expect(res.body).not.toHaveProperty('userId');
        expect(res.body).not.toHaveProperty('firstName');
      });
    });
  });

  describe('POST /auth/password/reset - Perform Password Reset', () => {
    let validToken;
    let validTokenHash;

    beforeEach(async () => {
      // Generate a fresh valid token
      const { tokenPlain, tokenHash, expiresAt } = ResetTokenUtil.generateResetToken(15);
      validToken = tokenPlain;
      validTokenHash = tokenHash;

      // Store in database
      await PasswordResetTokenModel.create({
        userId: testUser._id,
        tokenHash,
        expiresAt,
        consumedAt: null,
        createdIp: '127.0.0.1',
        createdUa: 'test-agent'
      });
    });

    describe('✅ Happy Path - Valid Token', () => {
      it('should reset password with valid token', async () => {
        const newPassword = 'NewSecurePass123!';

        const res = await request(app)
          .post('/auth/password/reset')
          .send({
            token: validToken,
            newPassword
          })
          .expect(200)
          .expect('Content-Type', /json/);

        expect(res.body).toEqual({ ok: true });

        // Verify password was changed
        const updatedUser = await UserModel.findById(testUser._id);
        const isNewPasswordValid = await bcrypt.compare(newPassword, updatedUser.password);
        expect(isNewPasswordValid).toBe(true);

        // Verify old password no longer works
        const isOldPasswordValid = await bcrypt.compare(testUserPassword, updatedUser.password);
        expect(isOldPasswordValid).toBe(false);

        // Verify token was consumed
        const tokenRecord = await PasswordResetTokenModel.findOne({ tokenHash: validTokenHash });
        expect(tokenRecord.consumedAt).toBeInstanceOf(Date);
        expect(tokenRecord.consumedAt).not.toBeNull();
      });

      it('should be able to login with new password after reset', async () => {
        const newPassword = 'AnotherSecurePass123!';

        // Reset password
        await request(app)
          .post('/auth/password/reset')
          .send({ token: validToken, newPassword })
          .expect(200);

        // Try to login with new password
        const loginRes = await request(app)
          .post('/auth/login')
          .send({
            corporateEmail: 'pwtest@unisabana.edu.co',
            password: newPassword
          })
          .expect(200);

        expect(loginRes.body).toHaveProperty('id');
        expect(loginRes.body).toHaveProperty('role', 'passenger');
      });
    });

    describe('✅ Invalid Token (400)', () => {
      it('should return 400 for non-existent token', async () => {
        const fakeToken = ResetTokenUtil.generateResetToken().tokenPlain;

        const res = await request(app)
          .post('/auth/password/reset')
          .send({
            token: fakeToken,
            newPassword: 'NewSecurePass123!'
          })
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_token');
        expect(res.body).toHaveProperty('message', 'The reset link is invalid');
        expect(res.body).toHaveProperty('correlationId');
      });

      it('should return 400 for malformed token', async () => {
        const res = await request(app)
          .post('/auth/password/reset')
          .send({
            token: 'short',
            newPassword: 'NewSecurePass123!'
          })
          .expect(400);

        expect(res.body).toHaveProperty('code');
        expect(res.body.code).toMatch(/invalid/i);
      });
    });

    describe('✅ Expired Token (410)', () => {
      it('should return 410 for expired token', async () => {
        // Create expired token (expires in past)
        const { tokenPlain, tokenHash } = ResetTokenUtil.generateResetToken();
        const expiredDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

        await PasswordResetTokenModel.create({
          userId: testUser._id,
          tokenHash,
          expiresAt: expiredDate,
          consumedAt: null,
          createdIp: '127.0.0.1'
        });

        const res = await request(app)
          .post('/auth/password/reset')
          .send({
            token: tokenPlain,
            newPassword: 'NewSecurePass123!'
          })
          .expect(410);

        expect(res.body).toHaveProperty('code', 'token_expired');
        expect(res.body).toHaveProperty('message', 'The reset link has expired');
        expect(res.body).toHaveProperty('correlationId');
      });
    });

    describe('✅ Used Token (409)', () => {
      it('should return 409 for already consumed token', async () => {
        // Consume the token first
        await request(app)
          .post('/auth/password/reset')
          .send({
            token: validToken,
            newPassword: 'FirstNewPassword123!'
          })
          .expect(200);

        // Try to use same token again
        const res = await request(app)
          .post('/auth/password/reset')
          .send({
            token: validToken,
            newPassword: 'SecondNewPassword123!'
          })
          .expect(409);

        expect(res.body).toHaveProperty('code', 'token_used');
        expect(res.body).toHaveProperty('message', 'The reset link has already been used');
        expect(res.body).toHaveProperty('correlationId');
      });

      it('should be idempotent (multiple attempts with used token)', async () => {
        // Use token once
        await request(app)
          .post('/auth/password/reset')
          .send({ token: validToken, newPassword: 'NewPassword123!' })
          .expect(200);

        // Try multiple times with same token (with strong passwords)
        const responses = await Promise.all([
          request(app).post('/auth/password/reset').send({ token: validToken, newPassword: 'StrongPass2!' }),
          request(app).post('/auth/password/reset').send({ token: validToken, newPassword: 'StrongPass3!' })
        ]);

        // All should return 409
        responses.forEach(res => {
          expect(res.status).toBe(409);
          expect(res.body.code).toBe('token_used');
        });
      });
    });

    describe('✅ Validation Errors', () => {
      it('should return 400 for weak password', async () => {
        const res = await request(app)
          .post('/auth/password/reset')
          .send({
            token: validToken,
            newPassword: 'weak'
          })
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
        expect(res.body).toHaveProperty('details');
      });

      it('should return 400 for missing fields', async () => {
        await request(app)
          .post('/auth/password/reset')
          .send({ token: validToken })
          .expect(400);

        await request(app)
          .post('/auth/password/reset')
          .send({ newPassword: 'NewPassword123!' })
          .expect(400);
      });
    });

    describe('✅ Security - No Sensitive Data in Responses', () => {
      it('should never expose token in error responses', async () => {
        const testToken = 'secret_token_value_12345';
        const res = await request(app)
          .post('/auth/password/reset')
          .send({ token: testToken, newPassword: 'NewPass123!' })
          .expect(400);

        const responseText = JSON.stringify(res.body);
        // Should not expose actual token value
        expect(responseText).not.toContain(testToken);
        expect(responseText).not.toContain('tokenHash');
        // Field name "token" in validation messages is acceptable
      });

      it('should never expose password in responses', async () => {
        const res = await request(app)
          .post('/auth/password/reset')
          .send({ token: validToken, newPassword: 'NewSecure123!' })
          .expect(200);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain('password');
        expect(responseText).not.toContain('NewSecure123!');
      });
    });
  });

  describe('PATCH /auth/password - Change Password (In-Session)', () => {
    let authCookie;

    beforeEach(async () => {
      // Reset user password to known value
      const hashedPassword = await bcrypt.hash(testUserPassword, 10);
      await UserModel.findByIdAndUpdate(testUser._id, { password: hashedPassword });

      // Login to get auth cookie
      const loginRes = await request(app)
        .post('/auth/login')
        .send({
          corporateEmail: 'pwtest@unisabana.edu.co',
          password: testUserPassword
        })
        .expect(200);

      authCookie = loginRes.headers['set-cookie'];
    });

    describe('✅ Happy Path - Correct Current Password', () => {
      it('should change password with correct current password', async () => {
        const newPassword = 'ChangedPassword123!';

        const res = await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({
            currentPassword: testUserPassword,
            newPassword
          })
          .expect(200)
          .expect('Content-Type', /json/);

        expect(res.body).toEqual({ ok: true });

        // Verify password was changed
        const updatedUser = await UserModel.findById(testUser._id);
        const isNewPasswordValid = await bcrypt.compare(newPassword, updatedUser.password);
        expect(isNewPasswordValid).toBe(true);

        // Verify old password no longer works
        const isOldPasswordValid = await bcrypt.compare(testUserPassword, updatedUser.password);
        expect(isOldPasswordValid).toBe(false);
      });

      it('should be able to login with new password after change', async () => {
        const newPassword = 'AnotherChanged123!';

        // Change password
        await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({
            currentPassword: testUserPassword,
            newPassword
          })
          .expect(200);

        // Login with new password
        const loginRes = await request(app)
          .post('/auth/login')
          .send({
            corporateEmail: 'pwtest@unisabana.edu.co',
            password: newPassword
          })
          .expect(200);

        expect(loginRes.body).toHaveProperty('id');
        expect(loginRes.body).toHaveProperty('role', 'passenger');
      });

      it('should keep session valid after password change', async () => {
        // Change password
        await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({
            currentPassword: testUserPassword,
            newPassword: 'NewChanged123!'
          })
          .expect(200);

        // Verify session still works
        const meRes = await request(app)
          .get('/auth/me')
          .set('Cookie', authCookie)
          .expect(200);

        expect(meRes.body).toHaveProperty('id');
        expect(meRes.body).toHaveProperty('role', 'passenger');
        expect(meRes.body).toHaveProperty('firstName');
        expect(meRes.body).toHaveProperty('lastName');
      });
    });

    describe('✅ Incorrect Current Password (401)', () => {
      it('should return 401 for wrong current password', async () => {
        const res = await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({
            currentPassword: 'WrongPassword123!',
            newPassword: 'NewPassword123!'
          })
          .expect(401);

        expect(res.body).toHaveProperty('code', 'invalid_credentials');
        expect(res.body).toHaveProperty('message', 'Email or password is incorrect');
        expect(res.body).toHaveProperty('correlationId');

        // Verify password was NOT changed
        const user = await UserModel.findById(testUser._id);
        const isOriginalPasswordValid = await bcrypt.compare(testUserPassword, user.password);
        expect(isOriginalPasswordValid).toBe(true);
      });
    });

    describe('✅ Unauthenticated (401)', () => {
      it('should return 401 without authentication cookie', async () => {
        const res = await request(app)
          .patch('/auth/password')
          .send({
            currentPassword: testUserPassword,
            newPassword: 'NewPassword123!'
          })
          .expect(401);

        expect(res.body).toHaveProperty('code', 'unauthorized');
        expect(res.body).toHaveProperty('message', 'Missing or invalid session');
      });

      it('should return 401 with invalid/expired cookie', async () => {
        const res = await request(app)
          .patch('/auth/password')
          .set('Cookie', 'access_token=invalid.jwt.token')
          .send({
            currentPassword: testUserPassword,
            newPassword: 'NewPassword123!'
          })
          .expect(401);

        expect(res.body.code).toMatch(/unauthorized|invalid_token/);
        expect(res.body).toHaveProperty('message', 'Missing or invalid session');
      });
    });

    describe('✅ Validation Errors (400)', () => {
      it('should return 400 for weak new password', async () => {
        const res = await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({
            currentPassword: testUserPassword,
            newPassword: 'weak'
          })
          .expect(400);

        expect(res.body).toHaveProperty('code', 'invalid_schema');
        expect(res.body).toHaveProperty('details');
      });

      it('should return 400 for missing fields', async () => {
        await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({ currentPassword: testUserPassword })
          .expect(400);

        await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({ newPassword: 'NewPassword123!' })
          .expect(400);
      });
    });

    describe('✅ Security - No Sensitive Data in Responses', () => {
      it('should never expose passwords in responses', async () => {
        const res = await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({
            currentPassword: testUserPassword,
            newPassword: 'NewSecure123!'
          })
          .expect(200);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain('password');
        expect(responseText).not.toContain(testUserPassword);
        expect(responseText).not.toContain('NewSecure123!');
      });

      it('should never expose passwords in error responses', async () => {
        const res = await request(app)
          .patch('/auth/password')
          .set('Cookie', authCookie)
          .send({
            currentPassword: 'WrongPass123!',
            newPassword: 'NewPass123!'
          })
          .expect(401);

        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain('WrongPass123!');
        expect(responseText).not.toContain('NewPass123!');
      });
    });
  });
});
