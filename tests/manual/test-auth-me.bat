@echo off
REM Manual Testing Script for GET /auth/me endpoint (Windows)
REM Run this script after starting the server (npm run dev)
REM
REM Prerequisites: curl and jq must be installed
REM Usage: test-auth-me.bat

setlocal

set BASE_URL=http://localhost:3001
set PASSENGER_EMAIL=supertest@unisabana.edu.co
set DRIVER_EMAIL=testdriver@unisabana.edu.co
set DRIVER_VEHICLE_EMAIL=testdrivervehicle@unisabana.edu.co
set PASSWORD=TestPassword123!

echo ==================================
echo Testing GET /auth/me endpoint
echo ==================================
echo.

REM Test 1: GET /auth/me without cookie (should return 401)
echo Test 1: GET /auth/me without cookie (expect 401)
curl -X GET "%BASE_URL%/auth/me" ^
  -H "Accept: application/json" ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.
echo ---
echo.

REM Test 2: GET /auth/me with invalid token (should return 401)
echo Test 2: GET /auth/me with invalid token (expect 401)
curl -X GET "%BASE_URL%/auth/me" ^
  -H "Accept: application/json" ^
  -H "Cookie: access_token=invalid.token.here" ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.
echo ---
echo.

REM Test 3: Login as passenger and call GET /auth/me
echo Test 3: Login as passenger
curl -X POST "%BASE_URL%/auth/login" ^
  -H "Content-Type: application/json" ^
  -H "Accept: application/json" ^
  -d "{\"corporateEmail\":\"%PASSENGER_EMAIL%\",\"password\":\"%PASSWORD%\"}" ^
  -c cookies.txt ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.

echo Test 4: GET /auth/me as passenger (expect 200, no driver object)
curl -X GET "%BASE_URL%/auth/me" ^
  -H "Accept: application/json" ^
  -b cookies.txt ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.
echo ---
echo.

REM Test 5: Login as driver WITHOUT vehicle
echo Test 5: Login as driver WITHOUT vehicle
curl -X POST "%BASE_URL%/auth/login" ^
  -H "Content-Type: application/json" ^
  -H "Accept: application/json" ^
  -d "{\"corporateEmail\":\"%DRIVER_EMAIL%\",\"password\":\"%PASSWORD%\"}" ^
  -c cookies_driver.txt ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.

echo Test 6: GET /auth/me as driver WITHOUT vehicle (expect driver.hasVehicle=false)
curl -X GET "%BASE_URL%/auth/me" ^
  -H "Accept: application/json" ^
  -b cookies_driver.txt ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.
echo ---
echo.

REM Test 7: Login as driver WITH vehicle
echo Test 7: Login as driver WITH vehicle
curl -X POST "%BASE_URL%/auth/login" ^
  -H "Content-Type: application/json" ^
  -H "Accept: application/json" ^
  -d "{\"corporateEmail\":\"%DRIVER_VEHICLE_EMAIL%\",\"password\":\"%PASSWORD%\"}" ^
  -c cookies_driver_vehicle.txt ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.

echo Test 8: GET /auth/me as driver WITH vehicle (expect driver.hasVehicle=true)
curl -X GET "%BASE_URL%/auth/me" ^
  -H "Accept: application/json" ^
  -b cookies_driver_vehicle.txt ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.
echo ---
echo.

REM Test 9: Verify idempotency
echo Test 9: Call GET /auth/me multiple times (verify idempotency)
for /L %%i in (1,1,3) do (
  echo Call #%%i:
  curl -X GET "%BASE_URL%/auth/me" ^
    -H "Accept: application/json" ^
    -b cookies.txt ^
    -s
  echo.
)
echo.
echo ---
echo.

REM Test 10: Logout and try to access
echo Test 10: Logout and try to access /auth/me (expect 401)
curl -X POST "%BASE_URL%/auth/logout" ^
  -b cookies.txt ^
  -c cookies.txt ^
  -s
echo.

curl -X GET "%BASE_URL%/auth/me" ^
  -H "Accept: application/json" ^
  -b cookies.txt ^
  -w "\nHTTP Status: %%{http_code}\n" ^
  -s
echo.

REM Cleanup
del cookies.txt cookies_driver.txt cookies_driver_vehicle.txt 2>nul

echo.
echo ==================================
echo All tests completed!
echo ==================================

endlocal
