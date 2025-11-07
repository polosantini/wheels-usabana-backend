const mongoose = require('mongoose');

const histogramSchema = new mongoose.Schema({
  '1': { type: Number, default: 0 },
  '2': { type: Number, default: 0 },
  '3': { type: Number, default: 0 },
  '4': { type: Number, default: 0 },
  '5': { type: Number, default: 0 }
}, { _id: false });

const driverRatingAggregateSchema = new mongoose.Schema({
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  avgRating: { type: Number, default: 0 },
  count: { type: Number, default: 0 },
  histogram: { type: histogramSchema, default: () => ({}) },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'driver_rating_aggregates' });

driverRatingAggregateSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('DriverRatingAggregate', driverRatingAggregateSchema);
