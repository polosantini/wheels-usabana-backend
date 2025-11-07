const mongoose = require('mongoose');

const deliveryAttemptSchema = new mongoose.Schema({
  providerMessageId: { type: String, required: true, index: true },
  providerEventId: { type: String, default: null },
  eventType: { type: String, required: true },
  recipientRedacted: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  raw: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

deliveryAttemptSchema.index({ providerMessageId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('DeliveryAttempt', deliveryAttemptSchema);
