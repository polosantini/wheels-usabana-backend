# GET /auth/me - Testing Documentation

## Overview
This document describes the testing strategy and acceptance criteria verification for the `GET /auth/me` endpoint (Session Verification).

## User Story
**AS AN** authenticated user  
**I WANT** an endpoint to verify my current session and fetch a minimal identity profile  
**SO THAT** the client can render protected UI without re-login

## Acceptance Criteria

### ✅ AC1: Valid cookie → 200 with DTO, Cache-Control: no-store
**Status:** ✅ Implemented and Tested

**Test Coverage:**
- Integration test: `should return 200 with minimal identity DTO for passenger`
- Integration test: `should return 200 with driver.hasVehicle=false for driver without vehicle`
- Integration test: `should return 200 with driver.hasVehicle=true for driver with vehicle`
- Integration test: `should include Cache-Control: no-store header`

**Response Structure:**
```json
{
  "id": "665e2a...f1",
  "role": "driver",
  "firstName": "John",
  "lastName": "Doe",
  "driver": {
    "hasVehicle": true
  }
}
```

**Headers:**
- `Cache-Control: no-store` ✅

### ✅ AC2: Missing/invalid/expired cookie → 401 unauthorized with standard error body
**Status:** ✅ Implemented and Tested

**Test Coverage:**
- Integration test: `should return 401 without access_token cookie`
- Integration test: `should return 401 with invalid/malformed token`
- Integration test: `should return 401 with expired token`

**Error Response:**
```json
{
  "code": "unauthorized",
  "message": "Missing or invalid session",
  "correlationId": "123e4567-e89b-12d3-a456-426614174000"
}
```

### ✅ AC3: DTO includes only whitelisted fields; no internal/secret data leaked
**Status:** ✅ Implemented and Tested

**Test Coverage:**
- All integration tests verify response structure
- Tests explicitly check that sensitive fields are NOT present

**Whitelisted Fields:**
- ✅ `id` - User ID
- ✅ `role` - User role (passenger/driver)
- ✅ `firstName` - User first name
- ✅ `lastName` - User last name
- ✅ `driver.hasVehicle` - Only for drivers

**Never Exposed:**
- ❌ `password` - Never returned
- ❌ `corporateEmail` - Not included in /auth/me
- ❌ `phone` - Not included in /auth/me
- ❌ `universityId` - Not included in /auth/me
- ❌ `createdAt` - Not included in /auth/me
- ❌ `updatedAt` - Not included in /auth/me
- ❌ JWT tokens - Never echoed

## Test Execution

### Automated Tests (Jest + Supertest)

**Run all tests:**
```bash
cd backend
npm test -- tests/integration/auth.test.js
```

**Test Suite Structure:**
```
Auth Integration Tests
├── POST /auth/login (existing)
├── POST /auth/logout (existing)
├── Protected Routes - Auth Middleware (existing)
├── CSRF Protection (existing)
├── GET /auth/me - Session Verification (NEW)
│   ├── should return 401 without access_token cookie ✅
│   ├── should return 401 with invalid/malformed token ✅
│   ├── should return 401 with expired token ✅
│   ├── should return 200 with minimal identity DTO for passenger ✅
│   ├── should return 200 with driver.hasVehicle=false for driver without vehicle ✅
│   ├── should return 200 with driver.hasVehicle=true for driver with vehicle ✅
│   ├── should include Cache-Control: no-store header ✅
│   ├── should be idempotent (multiple calls return same data) ✅
│   └── should include correlationId in error responses ✅
└── Cookie Flags Verification (existing)
```

### Manual Tests

**Prerequisites:**
1. Server running: `npm run dev` (from backend directory)
2. MongoDB connected and test users created
3. curl installed (or REST Client extension for VS Code)

**Option 1: VS Code REST Client**
- Open: `backend/tests/manual/test-auth-me.http`
- Click "Send Request" for each test

**Option 2: Bash Script (Linux/Mac/Git Bash)**
```bash
cd backend/tests/manual
bash test-auth-me.sh
```

**Option 3: Windows Batch Script**
```cmd
cd backend\tests\manual
test-auth-me.bat
```

**Option 4: Manual curl commands**
```bash
# Test 1: Without cookie (expect 401)
curl -X GET http://localhost:3001/auth/me -H "Accept: application/json"

# Test 2: Login first
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"corporateEmail":"user@unisabana.edu.co","password":"YourPassword123!"}' \
  -c cookies.txt

# Test 3: Call /auth/me with cookie (expect 200)
curl -X GET http://localhost:3001/auth/me \
  -H "Accept: application/json" \
  -b cookies.txt
```

## Test Data Requirements

**Test Users Needed:**
1. **Passenger** (no driver object in response)
   - Email: `supertest@unisabana.edu.co`
   - Password: `TestPassword123!`
   - Role: `passenger`

2. **Driver without vehicle** (driver.hasVehicle=false)
   - Email: `testdriver@unisabana.edu.co`
   - Password: `TestPassword123!`
   - Role: `driver`

3. **Driver with vehicle** (driver.hasVehicle=true)
   - Email: `testdrivervehicle@unisabana.edu.co`
   - Password: `TestPassword123!`
   - Role: `driver`
   - Vehicle: plate `ABC123`

## Security Verification

### PII Redaction
✅ Logs never contain:
- Passwords
- JWT tokens
- Email addresses (only domain logged)
- Phone numbers
- Cookie values

### Headers
✅ `Cache-Control: no-store` prevents caching
✅ `Content-Type: application/json` for consistency

### Error Handling
✅ Generic error messages (no user enumeration)
✅ Correlation ID for observability
✅ Consistent 401 for all auth failures

## OpenAPI Documentation

**Endpoint:** `GET /auth/me`
**Tags:** Authentication
**Security:** cookieAuth (access_token cookie)

**Responses:**
- `200` - Current user identity (with examples for passenger, driver with/without vehicle)
- `401` - Missing or invalid session

**OpenAPI Location:**
- Inline documentation: `backend/src/api/routes/authRoutes.js`
- Generated spec: `backend/docs/openapi.yaml`

**View Swagger UI:**
```
http://localhost:3001/api-docs
```

## Implementation Details

### Code Changes
1. **AuthService** (`backend/src/domain/services/AuthService.js`)
   - Added `getCurrentUserProfile()` method
   - Fetches user and checks vehicle status
   - Returns minimal DTO with hasVehicle flag

2. **AuthController** (`backend/src/api/controllers/authController.js`)
   - Added `getMe()` method
   - Protected by authenticate middleware
   - Sets Cache-Control header
   - Handles errors gracefully

3. **Routes** (`backend/src/api/routes/authRoutes.js`)
   - Added `GET /auth/me` route
   - Protected with authenticate middleware
   - Full OpenAPI documentation

4. **Tests** (`backend/tests/integration/auth.test.js`)
   - 9 new test cases for /auth/me
   - Coverage for all acceptance criteria
   - Test data setup for passengers and drivers

## Observability

### Structured Logging
```javascript
// Successful request
[AuthController] GET /auth/me | userId: 665e2a...f1 | role: driver | correlationId: abc-123

// Error (user not found - should never happen)
[AuthController] User not found (orphaned JWT?) | userId: 665e2a...f1 | correlationId: abc-123
```

### Metrics to Track
- Request count: `GET /auth/me`
- Response times (latency)
- Status codes: 200, 401, 500
- Correlation IDs for distributed tracing

## Troubleshooting

### Issue: 401 Unauthorized
**Causes:**
1. No access_token cookie sent
2. Invalid token format
3. Expired token
4. Wrong JWT_SECRET in server

**Solution:**
1. Verify login works: `POST /auth/login`
2. Check cookie is sent in request
3. Verify JWT_SECRET matches in .env
4. Check token expiry (default 2h)

### Issue: 500 Internal Error
**Causes:**
1. Database connection lost
2. User deleted but token still valid

**Solution:**
1. Check MongoDB connection
2. Verify test users exist
3. Check server logs for stack traces

### Issue: Missing driver.hasVehicle
**Cause:** User role is 'driver' but vehicle check failed

**Solution:**
1. Verify MongoVehicleRepository.findByDriverId() works
2. Check test vehicle exists in database

## Next Steps

After verification:
1. ✅ Deploy to staging environment
2. ✅ Run smoke tests in staging
3. ✅ Update API documentation
4. ✅ Notify frontend team of new endpoint
5. ✅ Monitor production metrics

## Related Documentation
- User Story: Session Verification Endpoint
- OpenAPI: `/api-docs` (Swagger UI)
- Integration Tests: `tests/integration/auth.test.js`
- Manual Tests: `tests/manual/test-auth-me.http`
