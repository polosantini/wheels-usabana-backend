#!/bin/bash
#
# Manual Testing Script for GET /auth/me endpoint
# Run this script after starting the server (npm run dev)
#
# Usage: bash test-auth-me.sh
#

BASE_URL="http://localhost:3001"
PASSENGER_EMAIL="supertest@unisabana.edu.co"
DRIVER_EMAIL="testdriver@unisabana.edu.co"
DRIVER_VEHICLE_EMAIL="testdrivervehicle@unisabana.edu.co"
PASSWORD="TestPassword123!"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================="
echo "Testing GET /auth/me endpoint"
echo "=================================="
echo ""

# Test 1: GET /auth/me without cookie (should return 401)
echo -e "${YELLOW}Test 1: GET /auth/me without cookie (expect 401)${NC}"
curl -X GET "$BASE_URL/auth/me" \
  -H "Accept: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.' || echo "Response not JSON"
echo ""
echo "---"
echo ""

# Test 2: GET /auth/me with invalid token (should return 401)
echo -e "${YELLOW}Test 2: GET /auth/me with invalid token (expect 401)${NC}"
curl -X GET "$BASE_URL/auth/me" \
  -H "Accept: application/json" \
  -H "Cookie: access_token=invalid.token.here" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.' || echo "Response not JSON"
echo ""
echo "---"
echo ""

# Test 3: Login as passenger and call GET /auth/me
echo -e "${YELLOW}Test 3: Login as passenger${NC}"
LOGIN_RESPONSE=$(curl -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{\"corporateEmail\":\"$PASSENGER_EMAIL\",\"password\":\"$PASSWORD\"}" \
  -c cookies.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -s)

echo "$LOGIN_RESPONSE" | head -n -1 | jq '.'
echo "$LOGIN_RESPONSE" | tail -n 1
echo ""

echo -e "${YELLOW}Test 4: GET /auth/me as passenger (expect 200, no driver object)${NC}"
curl -X GET "$BASE_URL/auth/me" \
  -H "Accept: application/json" \
  -b cookies.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -v -s 2>&1 | grep -E "(Cache-Control|HTTP/)" || true
curl -X GET "$BASE_URL/auth/me" \
  -H "Accept: application/json" \
  -b cookies.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

# Test 5: Login as driver WITHOUT vehicle
echo -e "${YELLOW}Test 5: Login as driver WITHOUT vehicle${NC}"
curl -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{\"corporateEmail\":\"$DRIVER_EMAIL\",\"password\":\"$PASSWORD\"}" \
  -c cookies_driver.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | head -n -1 | jq '.'
echo ""

echo -e "${YELLOW}Test 6: GET /auth/me as driver WITHOUT vehicle (expect driver.hasVehicle=false)${NC}"
curl -X GET "$BASE_URL/auth/me" \
  -H "Accept: application/json" \
  -b cookies_driver.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

# Test 7: Login as driver WITH vehicle
echo -e "${YELLOW}Test 7: Login as driver WITH vehicle${NC}"
curl -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{\"corporateEmail\":\"$DRIVER_VEHICLE_EMAIL\",\"password\":\"$PASSWORD\"}" \
  -c cookies_driver_vehicle.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | head -n -1 | jq '.'
echo ""

echo -e "${YELLOW}Test 8: GET /auth/me as driver WITH vehicle (expect driver.hasVehicle=true)${NC}"
curl -X GET "$BASE_URL/auth/me" \
  -H "Accept: application/json" \
  -b cookies_driver_vehicle.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

# Test 9: Verify idempotency
echo -e "${YELLOW}Test 9: Call GET /auth/me multiple times (verify idempotency)${NC}"
for i in {1..3}; do
  echo "Call #$i:"
  curl -X GET "$BASE_URL/auth/me" \
    -H "Accept: application/json" \
    -b cookies.txt \
    -s | jq '.id, .role, .firstName'
done
echo ""
echo "---"
echo ""

# Test 10: Logout and try to access
echo -e "${YELLOW}Test 10: Logout and try to access /auth/me (expect 401)${NC}"
curl -X POST "$BASE_URL/auth/logout" \
  -b cookies.txt \
  -c cookies.txt \
  -s | jq '.'
echo ""

curl -X GET "$BASE_URL/auth/me" \
  -H "Accept: application/json" \
  -b cookies.txt \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.'
echo ""

# Cleanup
rm -f cookies.txt cookies_driver.txt cookies_driver_vehicle.txt

echo ""
echo -e "${GREEN}=================================="
echo "All tests completed!"
echo "==================================${NC}"
