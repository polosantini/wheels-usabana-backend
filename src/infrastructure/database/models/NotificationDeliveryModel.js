const mongoose = require('mongoose');

const notificationDeliverySchema = new mongoose.Schema({
  providerMessageId: { type: String, required: true, unique: true, index: true },
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InAppNotification', default: null },
  status: { type: String, enum: ['pending','sent','delivered','bounced','complained','dropped','failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  lastEventAt: { type: Date, default: null },
  processedEvents: { type: [String], default: [] },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

// providerMessageId is already indexed via the field definition (unique: true)
// avoid duplicate index declarations

module.exports = mongoose.model('NotificationDelivery', notificationDeliverySchema);
