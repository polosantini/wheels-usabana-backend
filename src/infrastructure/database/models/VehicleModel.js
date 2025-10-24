const mongoose = require('mongoose');

/**
 * Vehicle Mongoose Schema
 * Enforces one-vehicle-per-driver business rule
 */
const vehicleSchema = new mongoose.Schema({
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Driver ID is required']
    // Note: index is defined separately below as unique
  },
  plate: {
    type: String,
    required: [true, 'Plate is required'],
    unique: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{3}[0-9]{3}$/, 'Plate must be in format ABC123 (3 letters, 3 numbers)'],
    index: true
  },
  brand: {
    type: String,
    required: [true, 'Brand is required'],
    trim: true,
    minlength: [2, 'Brand must be at least 2 characters'],
    maxlength: [60, 'Brand must not exceed 60 characters']
  },
  model: {
    type: String,
    required: [true, 'Model is required'],
    trim: true,
    minlength: [1, 'Model must be at least 1 character'],
    maxlength: [60, 'Model must not exceed 60 characters']
  },
  capacity: {
    type: Number,
    required: [true, 'Capacity is required'],
    min: [1, 'Capacity must be at least 1'],
    max: [20, 'Capacity must not exceed 20']
  },
  vehiclePhotoUrl: {
    type: String,
    default: null
  },
  soatPhotoUrl: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  strict: true,
  strictQuery: false
});

// Pre-save middleware to normalize data
vehicleSchema.pre('save', function(next) {
  // Normalize plate to uppercase
  if (this.plate) {
    this.plate = this.plate.toUpperCase().trim();
  }
  
  // Normalize brand and model
  if (this.brand) {
    this.brand = this.brand.trim();
  }
  if (this.model) {
    this.model = this.model.trim();
  }
  
  next();
});

// CRITICAL: Unique index on driverId to enforce one-vehicle-per-driver at DB level
// This prevents race conditions even without transactions
vehicleSchema.index({ driverId: 1 }, { unique: true });

// Compound index for driver + plate uniqueness (additional safety)
vehicleSchema.index({ driverId: 1, plate: 1 }, { unique: true });

// Static method to check if driver has vehicle
vehicleSchema.statics.driverHasVehicle = async function(driverId) {
  const count = await this.countDocuments({ driverId });
  return count > 0;
};

// Static method to find by driver ID
vehicleSchema.statics.findByDriverId = function(driverId) {
  return this.findOne({ driverId });
};

// Static method to find by plate
vehicleSchema.statics.findByPlate = function(plate) {
  return this.findOne({ plate: plate.toUpperCase() });
};

// Static method to check plate existence
vehicleSchema.statics.plateExists = async function(plate, excludeId = null) {
  const query = { plate: plate.toUpperCase() };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

const VehicleModel = mongoose.model('Vehicle', vehicleSchema);

module.exports = VehicleModel;

