const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.Mixed, required: false },
  // Store actor identifier as string (can be ObjectId hex or external id)
  who: { type: String, required: false },
    when: { type: Date, required: true, default: () => new Date() },
    what: { type: mongoose.Schema.Types.Mixed, default: {} }, // before/after snapshots
    why: { type: String, default: '' },
    correlationId: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null }
    ,prevHash: { type: String, default: null },
    hash: { type: String, default: null, index: true }
  },
  {
    timestamps: false,
    collection: 'audit_logs'
  }
);

// Append-only: do not allow updates via conventional APIs. We cannot enforce
// database-level immutability easily here, but we will rely on application
// conventions and tests to ensure entries are only created.

const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLogModel;
