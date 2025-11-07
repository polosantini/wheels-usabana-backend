const mongoose = require('mongoose');

const reviewReportCounterSchema = new mongoose.Schema(
  {
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Review',
      required: true,
      index: true
    },
    category: {
      type: String,
      enum: ['abuse', 'spam', 'fraud', 'other'],
      required: true,
      index: true
    },
    count: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: { updatedAt: true, createdAt: false },
    collection: 'review_report_counters'
  }
);

// Unique per (review, category)
reviewReportCounterSchema.index({ reviewId: 1, category: 1 }, { unique: true });

const ReviewReportCounterModel = mongoose.model('ReviewReportCounter', reviewReportCounterSchema);

module.exports = ReviewReportCounterModel;
