const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TripOffer',
      required: [true, 'Trip ID is required'],
      index: true
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Driver ID is required'],
      index: true
    },
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Passenger ID is required'],
      index: true
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be between 1 and 5'],
      max: [5, 'Rating must be between 1 and 5'],
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be an integer'
      }
    },
    text: {
      type: String,
      trim: true,
      maxlength: [1000, 'Review text cannot exceed 1000 characters'],
      default: ''
    },
    tags: {
      type: [String],
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length <= 5;
        },
        message: 'Max 5 tags allowed'
      },
      default: []
    },
    status: {
      type: String,
      enum: ['visible', 'hidden', 'flagged'],
      default: 'visible',
      index: true
    },
    // Immutable audit trail - record edits with timestamp and previous text/rating
    audit: {
      type: [
        {
          editedAt: { type: Date },
          rating: { type: Number },
          text: { type: String }
        }
      ],
      default: []
    }
    ,
    // Moderation actions performed by admins: hide/unhide with reason and moderator id
    moderation: {
      type: [
        {
          moderatedAt: { type: Date },
          moderatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          action: { type: String, enum: ['hide', 'unhide'] },
          reason: { type: String },
          correlationId: { type: String }
        }
      ],
      default: []
    }
  },
  {
    timestamps: true,
    collection: 'reviews'
  }
);

// Ensure one review per passenger per trip
reviewSchema.index({ passengerId: 1, tripId: 1 }, { unique: true });

// Index for driver aggregates
reviewSchema.index({ driverId: 1, status: 1 });

const ReviewModel = mongoose.model('Review', reviewSchema);

module.exports = ReviewModel;
