/**
 * Test Helpers
 * Common utilities for integration tests
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
let memoryServer = null; // mongodb-memory-server instance (for tests)

/**
 * Connect to test database
 */
async function connectTestDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wheels-unisabana-test';
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
  } catch (err) {
    // Fallback to in-memory MongoDB for tests when local/remote is unavailable
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    const memUri = memoryServer.getUri();
    await mongoose.connect(memUri);
  }
}

/**
 * Disconnect from test database
 */
async function disconnectTestDB() {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

/**
 * Clear all collections in test database
 */
async function clearDatabase() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

// Note: createTestUser is implemented later to persist users in the DB for integration tests

/**
 * Generate random plate
 */
function generateRandomPlate() {
  const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
                  String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
                  String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const numbers = Math.floor(100 + Math.random() * 900);
  return `${letters}${numbers}`;
}

/**
 * Create test image file
 */
function createTestImage(filename = 'test-image.jpg') {
  const testDir = path.join(__dirname, '../test-files');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Create a small valid JPEG (1x1 pixel, red)
  const validJpeg = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
    0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x09, 0xFF, 0xC4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF,
    0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xD2, 0xCF, 0x20,
    0xFF, 0xD9
  ]);
  
  const imagePath = path.join(testDir, filename);
  fs.writeFileSync(imagePath, validJpeg);
  return imagePath;
}

/**
 * Create large test file (for testing size limits)
 */
function createLargeTestFile(filename = 'large-file.jpg', sizeMB = 6) {
  const testDir = path.join(__dirname, '../test-files');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const buffer = Buffer.alloc(sizeMB * 1024 * 1024);
  const filePath = path.join(testDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Cleanup test files
 */
function cleanupTestFiles() {
  const testDir = path.join(__dirname, '../test-files');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Count files in uploads directory
 */
function countUploadedFiles(subfolder = 'vehicles') {
  const uploadsDir = path.join(__dirname, '../../uploads', subfolder);
  if (!fs.existsSync(uploadsDir)) {
    return 0;
  }
  return fs.readdirSync(uploadsDir).length;
}

/**
 * Cleanup uploads directory
 */
function cleanupUploads(subfolder = 'vehicles') {
  const uploadsDir = path.join(__dirname, '../../uploads', subfolder);
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    files.forEach(file => {
      fs.unlinkSync(path.join(uploadsDir, file));
    });
  }
}

  /**
   * Create a test user in database
   */
  async function createTestUser(role = 'passenger', email = null) {
    const UserModel = require('../../src/infrastructure/database/models/UserModel');
    const randomId = Math.floor(300000 + Math.random() * 99999);
    const corporateEmail = email || `test${randomId}@unisabana.edu.co`;

    const user = await UserModel.create({
      firstName: 'Test',
      lastName: role === 'driver' ? 'Driver' : 'Passenger',
      corporateEmail,
      universityId: `U${Math.floor(100000 + Math.random() * 899999)}`,
      phone: '+573001234567',
      password: 'hashed-password',
      role
    });

    return {
      id: user._id.toString(),
      corporateEmail: user.corporateEmail,
      role: user.role
    };
  }

  /**
   * Login user and get JWT token
   */
  async function loginUser(email, password = 'SecurePass123!') {
    const UserModel = require('../../src/infrastructure/database/models/UserModel');
    const AuthService = require('../../src/domain/services/AuthService');

    const user = await UserModel.findOne({ corporateEmail: email });
    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    const authService = new AuthService();
    // Sign a JWT matching our middleware expectations
    return authService.signAccessToken({
      sub: user._id.toString(),
      role: user.role,
      email: user.corporateEmail
    });
  }

  /**
   * Create a test vehicle in database
   */
  async function createTestVehicle(ownerId, plate, brand = 'Toyota', model = 'Corolla', year = 2022, capacity = 4) {
    const VehicleModel = require('../../src/infrastructure/database/models/VehicleModel');
  
    const vehicle = await VehicleModel.create({
      driverId: ownerId,
      brand,
      model,
      // year and color not in schema; ensure only schema fields are set
      plate,
      capacity
    });

    return vehicle._id.toString();
  }

  /**
   * Create a test trip in database
   */
  async function createTestTrip(driverId, vehicleId, options = {}) {
    const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
  
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const trip = await TripOfferModel.create({
      driverId,
      vehicleId,
      origin: options.origin || {
        text: 'Universidad de La Sabana',
        geo: { lat: 4.8611, lng: -74.0315 }
      },
      destination: options.destination || {
        text: 'Centro Comercial Andino',
        geo: { lat: 4.6706, lng: -74.0554 }
      },
      departureAt: options.departureAt || tomorrow,
      estimatedArrivalAt: options.estimatedArrivalAt || new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000),
      pricePerSeat: options.pricePerSeat || 15000,
      totalSeats: options.totalSeats || 3,
      status: options.status || 'published',
      notes: options.notes || ''
    });

    return trip._id.toString();
  }

  /**
   * Create a test booking request in database
   */
  async function createTestBookingRequest(passengerId, tripId, options = {}) {
    const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');
  
    const booking = await BookingRequestModel.create({
      passengerId,
      tripId,
      seats: options.seats || 1,
      note: options.note || '',
      status: options.status || 'pending'
    });

    return booking._id.toString();
  }

  /**
   * Cleanup all test data
   */
  async function cleanupTestData() {
    const UserModel = require('../../src/infrastructure/database/models/UserModel');
    const VehicleModel = require('../../src/infrastructure/database/models/VehicleModel');
    const TripOfferModel = require('../../src/infrastructure/database/models/TripOfferModel');
    const BookingRequestModel = require('../../src/infrastructure/database/models/BookingRequestModel');
    const SeatLedgerModel = require('../../src/infrastructure/database/models/SeatLedgerModel');

    await BookingRequestModel.deleteMany({});
    await TripOfferModel.deleteMany({});
    await VehicleModel.deleteMany({});
    await UserModel.deleteMany({ corporateEmail: /@unisabana\.edu\.co/ });
    await SeatLedgerModel.deleteMany({});
  }

module.exports = {
  connectTestDB,
  disconnectTestDB,
  clearDatabase,
  createTestUser,
    loginUser,
    createTestVehicle,
    createTestTrip,
    createTestBookingRequest,
    cleanupTestData,
  generateRandomPlate,
  createTestImage,
  createLargeTestFile,
  cleanupTestFiles,
  countUploadedFiles,
  cleanupUploads
};

