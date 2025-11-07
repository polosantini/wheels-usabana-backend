const mongoose = require('mongoose');

const notificationMetricSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  type: { type: String, required: true, index: true },
  channel: { type: String, required: true, index: true },
  rendered: { type: Number, default: 0 },
  attempted: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  bounced: { type: Number, default: 0 },
  complained: { type: Number, default: 0 },
  skippedByPreferences: { type: Number, default: 0 }
}, { timestamps: true });

notificationMetricSchema.index({ date: 1, type: 1, channel: 1 }, { unique: true });

module.exports = mongoose.model('NotificationMetric', notificationMetricSchema);
