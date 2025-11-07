const mongoose = require('mongoose');


const reviewReportSchema = new mongoose.Schema(
  {
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Review',
      required: true,
      index: true
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    category: {
      type: String,
      enum: ['abuse', 'spam', 'fraud', 'other'],
      required: true,
      index: true
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    correlationId: {
      type: String,
      default: null,
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'review_reports'
  }
);

// Prevent duplicate report records per user per review (one report per reporter per review)
reviewReportSchema.index({ reviewId: 1, reporterId: 1 }, { unique: true });

const ReviewReportModel = mongoose.model('ReviewReport', reviewReportSchema);

module.exports = ReviewReportModel;
