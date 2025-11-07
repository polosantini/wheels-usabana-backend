const mongoose = require('mongoose');

const docSchema = new mongoose.Schema({
  storagePath: { type: String, required: true },
  hash: { type: String, required: true },
  uploadedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: false }
}, { _id: false });

const driverVerificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  status: { type: String, enum: ['unverified','pending_review','verified','rejected','expired'], default: 'unverified' },
  fullName: { type: String, required: false },
  documentNumberHash: { type: String, required: false },
  documents: {
    govIdFront: { type: docSchema, required: false },
    govIdBack: { type: docSchema, required: false },
    driverLicense: { type: docSchema, required: false },
    soat: { type: docSchema, required: false }
  },
  licenseNumberHash: { type: String, required: false },
  soatNumberHash: { type: String, required: false },
  submittedAt: { type: Date, required: false },
  lastUpdatedAt: { type: Date, required: false },
  adminNotes: [{ adminId: String, notes: String, createdAt: Date }],
  // Review metadata
  decisionAt: { type: Date, required: false },
  reviewedBy: { type: String, required: false },
  rejectionReason: { type: String, required: false }
  ,
  // Reminders history to avoid duplicate sends per window (e.g. '30d','7d','1d')
  remindersSent: [{ window: String, sentAt: Date }]
}, { timestamps: true });

module.exports = mongoose.model('DriverVerification', driverVerificationSchema);
