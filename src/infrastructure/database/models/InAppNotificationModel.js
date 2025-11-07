const mongoose = require('mongoose');

const inAppNotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    default: '',
    trim: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  correlationId: {
    type: String,
    default: null
  }
}, {
  timestamps: { createdAt: true, updatedAt: true },
  strict: true
});

// Compound index for feed queries (user + createdAt desc)
inAppNotificationSchema.index({ userId: 1, createdAt: -1 });

const InAppNotificationModel = mongoose.model('InAppNotification', inAppNotificationSchema);

module.exports = InAppNotificationModel;
