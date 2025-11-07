const mongoose = require('mongoose');

const documentPreviewSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  docType: { type: String, required: true, enum: ['govIdFront','govIdBack','driverLicense','soat'] },
  createdBy: { type: String, required: true }, // admin id
  createdAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, required: true, default: false },
  usedAt: { type: Date },
  accessorIp: { type: String },
  accessorUserAgent: { type: String }
}, { timestamps: false });

module.exports = mongoose.model('DocumentPreview', documentPreviewSchema);
