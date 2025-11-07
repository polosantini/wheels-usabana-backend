const mongoose = require('mongoose');

const auditAnchorSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
  hmac: { type: String, required: true },
  keyVersion: { type: String, required: false },
  entries: { type: Number, required: false, default: 0 },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
});

module.exports = mongoose.model('AuditAnchor', auditAnchorSchema);
