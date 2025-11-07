const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  evidenceId: { type: String, required: true, unique: true, index: true },
  filename: { type: String, required: true },
  contentType: { type: String, required: true },
  storagePath: { type: String, default: null },
  uploadToken: { type: String, default: null },
  uploadExpiresAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  uploadedAt: { type: Date, default: null }
});

module.exports = mongoose.model('Evidence', evidenceSchema);
