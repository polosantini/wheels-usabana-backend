const mongoose = require('mongoose');

const geoLocationSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    geo: {
      lat: {
        type: Number,
        required: true,
        min: -90,
        max: 90
      },
      lng: {
        type: Number,
        required: true,
        min: -180,
        max: 180
      }
    }
  },
  { _id: false }
);

const tripOfferSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true
    },
    origin: {
      type: geoLocationSchema,
      required: true
    },
    destination: {
      type: geoLocationSchema,
      required: true
    },
    departureAt: {
      type: Date,
      required: true,
      index: true
    },
    estimatedArrivalAt: {
      type: Date,
      required: true
    },
    pricePerSeat: {
      type: Number,
      required: true,
      min: 0,
      get: (v) => {
        // Ensure 2 decimal places when retrieving
        return v !== undefined ? Math.round(v * 100) / 100 : v;
      },
      set: (v) => {
        // Ensure 2 decimal places when storing
        return v !== undefined ? Math.round(v * 100) / 100 : v;
      }
    },
    totalSeats: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'totalSeats must be an integer'
      }
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'canceled', 'completed'],
      default: 'published',
      index: true
    },
    routeDescription: {
      type: String,
      maxlength: 500,
      default: '',
      trim: true
    },
    notes: {
      type: String,
      maxlength: 500,
      default: '',
      trim: true
    }
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true }
  }
);

// Compound index for driver queries sorted by departure time
tripOfferSchema.index({ driverId: 1, departureAt: 1 });

// Index for finding published trips by date range
tripOfferSchema.index({ status: 1, departureAt: 1 });

// Optional: 2dsphere index for future geo search (currently not needed)
// tripOfferSchema.index({ 'origin.geo': '2dsphere' });
// tripOfferSchema.index({ 'destination.geo': '2dsphere' });

// Validation: estimatedArrivalAt must be after departureAt
tripOfferSchema.pre('save', function (next) {
  if (this.departureAt >= this.estimatedArrivalAt) {
    return next(new Error('estimatedArrivalAt must be after departureAt'));
  }
  next();
});

// Validation: departureAt must be in future on create/publish (not on updates to existing docs)
tripOfferSchema.pre('save', function (next) {
  if (this.isNew && (this.status === 'published' || this.status === 'draft')) {
    // Use < instead of <= to allow dates that are exactly "now" (within same millisecond)
    // This helps with test timing issues while still enforcing future dates
    if (this.departureAt < new Date()) {
      return next(new Error('departureAt must be in the future'));
    }
  }
  next();
});

// Virtual for checking if trip is in the past
tripOfferSchema.virtual('isPast').get(function () {
  return this.departureAt < new Date();
});

// Virtual for checking if trip is editable
tripOfferSchema.virtual('isEditable').get(function () {
  return this.status !== 'canceled' && this.status !== 'completed';
});

// Instance method: Check if trip overlaps with another time window
tripOfferSchema.methods.overlapsWith = function (otherDepartureAt, otherArrivalAt) {
  return (
    this.departureAt < otherArrivalAt && this.estimatedArrivalAt > otherDepartureAt
  );
};

// Static method: Find overlapping published trips for a driver
tripOfferSchema.statics.findOverlappingTrips = async function (
  driverId,
  departureAt,
  estimatedArrivalAt,
  excludeTripId = null
) {
  const query = {
    driverId,
    status: 'published',
    // Check for overlap: trip.departureAt < estimatedArrivalAt AND trip.estimatedArrivalAt > departureAt
    departureAt: { $lt: estimatedArrivalAt },
    estimatedArrivalAt: { $gt: departureAt }
  };

  if (excludeTripId) {
    query._id = { $ne: excludeTripId };
  }

  return this.find(query);
};

// Static method: Find driver's trips by status
tripOfferSchema.statics.findByDriverAndStatus = function (driverId, status) {
  return this.find({ driverId, status }).sort({ departureAt: 1 });
};

// Static method: Find driver's upcoming published trips
tripOfferSchema.statics.findUpcomingByDriver = function (driverId) {
  return this.find({
    driverId,
    status: 'published',
    departureAt: { $gt: new Date() }
  }).sort({ departureAt: 1 });
};

const TripOfferModel = mongoose.model('TripOffer', tripOfferSchema);

module.exports = TripOfferModel;
