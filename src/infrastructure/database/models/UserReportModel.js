const mongoose = require('mongoose');

const userReportSchema = new mongoose.Schema(
  {
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TripOffer',
      required: true,
      index: true
    },
    category: {
      type: String,
      enum: ['abuse', 'harassment', 'fraud', 'no_show', 'unsafe_behavior', 'other'],
      required: true,
      index: true
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'resolved'],
      default: 'pending',
      index: true
    },
    correlationId: {
      type: String,
      default: null,
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'user_reports'
  }
);

// Prevent duplicate report records per user per trip (one report per reporter per user per trip)
userReportSchema.index({ reportedUserId: 1, reporterId: 1, tripId: 1 }, { unique: true });

const UserReportModel = mongoose.model('UserReport', userReportSchema);

module.exports = UserReportModel;

