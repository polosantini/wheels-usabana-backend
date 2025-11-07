const mongoose = require('mongoose');

const moderationNoteSchema = new mongoose.Schema({
  entity: { type: String, enum: ['user','trip','booking'], required: true, index: true },
  entityId: { type: String, required: true, index: true },
  category: { type: String, required: true },
  reason: { type: String, required: true },
  evidence: [{ type: String }], // array of evidence ids
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: false });

module.exports = mongoose.model('ModerationNote', moderationNoteSchema);
