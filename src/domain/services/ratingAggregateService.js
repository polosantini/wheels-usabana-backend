const mongoose = require('mongoose');
const ReviewModel = require('../../infrastructure/database/models/ReviewModel');
const DriverRatingAggregate = require('../../infrastructure/database/models/DriverRatingAggregateModel');

class RatingAggregateService {
  /**
   * Recompute aggregates for a driver by scanning visible reviews and upserting the aggregate doc.
   * If a session is supplied, the upsert runs within that session.
   */
  static async recomputeAggregate(driverId, session = null) {
    // Aggregation: match visible reviews for driver, group by rating
    const driverObjId = mongoose.Types.ObjectId.isValid(driverId) ? new mongoose.Types.ObjectId(driverId) : driverId;
    const pipeline = [
      { $match: { driverId: driverObjId, status: 'visible' } },
      { $group: { _id: '$rating', count: { $sum: 1 }, sumRating: { $sum: '$rating' } } }
    ];

    const results = await ReviewModel.aggregate(pipeline).exec();

    // Build histogram and compute totals
    const histogram = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let total = 0;
    let sum = 0;
    for (const r of results) {
      const key = String(r._id);
      if (histogram.hasOwnProperty(key)) {
        histogram[key] = r.count;
        total += r.count;
        sum += r._id * r.count;
      }
    }

    const avg = total === 0 ? 0 : Math.round((sum / total) * 10) / 10; // one decimal

    const update = {
      driverId,
      avgRating: avg,
      count: total,
      histogram,
      updatedAt: new Date()
    };

    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };

    if (session) {
      return DriverRatingAggregate.findOneAndUpdate({ driverId }, update, { ...opts, session }).lean();
    }

    return DriverRatingAggregate.findOneAndUpdate({ driverId }, update, opts).lean();
  }

  /**
   * Get aggregate document; if missing, recompute on the fly.
   */
  static async getAggregate(driverId) {
    let agg = await DriverRatingAggregate.findOne({ driverId }).lean();
    if (!agg) {
      agg = await this.recomputeAggregate(driverId);
    }
    return agg;
  }
}

module.exports = RatingAggregateService;
