const Joi = require('joi');

/**
 * Validation schemas for admin listing endpoints
 */

const paginationQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1).optional(),
  pageSize: Joi.number().integer().min(1).max(100).default(25).optional(),
  sort: Joi.string().optional()
}).options({ abortEarly: false, stripUnknown: true });

const listTripsQuery = Joi.object({
  status: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
  driverId: Joi.string().pattern(/^[a-f\d]{24}$/i).optional(),
  from: Joi.string().max(200).optional(),
  to: Joi.string().max(200).optional(),
  departureFrom: Joi.date().iso().optional(),
  departureTo: Joi.date().iso().optional()
}).concat(paginationQuery).options({ abortEarly: false, stripUnknown: true });

const listBookingsQuery = Joi.object({
  tripId: Joi.string().pattern(/^[a-f\d]{24}$/i).optional(),
  passengerId: Joi.string().pattern(/^[a-f\d]{24}$/i).optional(),
  status: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
  paid: Joi.alternatives().try(Joi.string().valid('true','false'), Joi.boolean()).optional(),
  createdFrom: Joi.date().iso().optional(),
  createdTo: Joi.date().iso().optional()
}).concat(paginationQuery).options({ abortEarly: false, stripUnknown: true });

const listRefundsQuery = Joi.object({
  status: Joi.string().optional(),
  reason: Joi.string().max(500).optional(),
  transactionId: Joi.string().optional(),
  bookingId: Joi.string().pattern(/^[a-f\d]{24}$/i).optional(),
  createdFrom: Joi.date().iso().optional(),
  createdTo: Joi.date().iso().optional()
}).concat(paginationQuery).options({ abortEarly: false, stripUnknown: true });

const suspendUserSchema = Joi.object({
  action: Joi.string().valid('suspend', 'unsuspend').required(),
  reason: Joi.string().min(3).max(500).required()
}).options({ abortEarly: false, stripUnknown: true });

const forceCancelTripSchema = Joi.object({
  reason: Joi.string().min(3).max(1000).required()
}).options({ abortEarly: false, stripUnknown: true });

const publishBanSchema = Joi.object({
  banUntil: Joi.alternatives().try(Joi.date().iso().greater('now'), Joi.valid(null)).required(),
  reason: Joi.string().min(3).max(500).required()
}).options({ abortEarly: false, stripUnknown: true });

const correctBookingStateSchema = Joi.object({
  targetState: Joi.string().valid('declined_by_admin', 'canceled_by_platform').required(),
  refund: Joi.object({
    amount: Joi.number().positive().required(),
    reason: Joi.string().max(500).required()
  }).optional(),
  reason: Joi.string().min(3).max(1000).required()
}).options({ abortEarly: false, stripUnknown: true });

module.exports = {
  listTripsQuery,
  listBookingsQuery,
  listRefundsQuery
  ,suspendUserSchema,
  forceCancelTripSchema
  ,correctBookingStateSchema
  ,publishBanSchema
};

// Moderation schemas
const moderationNoteSchema = Joi.object({
  entity: Joi.string().valid('user','trip','booking').required(),
  entityId: Joi.string().required(),
  category: Joi.string().valid('safety','fraud','conduct','other').required(),
  reason: Joi.string().min(3).max(1000).required(),
  evidence: Joi.array().items(Joi.string()).optional()
}).options({ abortEarly: false, stripUnknown: true });

const evidenceUploadRequestSchema = Joi.object({
  filename: Joi.string().max(255).required(),
  contentType: Joi.string().required()
}).options({ abortEarly: false, stripUnknown: true });

const listModerationNotesQuery = Joi.object({
  entity: Joi.string().valid('user','trip','booking').required(),
  entityId: Joi.string().required(),
  page: Joi.number().integer().min(1).default(1).optional(),
  pageSize: Joi.number().integer().min(1).max(100).default(20).optional()
}).options({ abortEarly: false, stripUnknown: true });

module.exports.moderationNoteSchema = moderationNoteSchema;
module.exports.evidenceUploadRequestSchema = evidenceUploadRequestSchema;
module.exports.listModerationNotesQuery = listModerationNotesQuery;

// Audit listing and export schemas
const listAuditQuery = Joi.object({
  entity: Joi.string().optional(),
  entityId: Joi.string().optional(),
  who: Joi.string().optional(),
  actorId: Joi.string().optional(),
  actorType: Joi.string().valid('admin','user','system').optional(),
  action: Joi.string().optional(), // prefix search
  entityType: Joi.string().optional(),
  correlationId: Joi.string().optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  page: Joi.number().integer().min(1).default(1).optional(),
  pageSize: Joi.number().integer().min(1).max(200).default(50).optional(),
  sort: Joi.string().optional()
}).options({ abortEarly: false, stripUnknown: true });

const exportAuditQuery = Joi.object({
  entity: Joi.string().optional(),
  entityId: Joi.string().optional(),
  who: Joi.string().optional(),
  actorId: Joi.string().optional(),
  actorType: Joi.string().valid('admin','user','system').optional(),
  action: Joi.string().optional(),
  entityType: Joi.string().optional(),
  correlationId: Joi.string().optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
}).options({ abortEarly: false, stripUnknown: true });

module.exports.listAuditQuery = listAuditQuery;
module.exports.exportAuditQuery = exportAuditQuery;

const integrityQuery = Joi.object({
  from: Joi.date().iso().required(),
  to: Joi.date().iso().required()
}).options({ abortEarly: false, stripUnknown: true });

module.exports.integrityQuery = integrityQuery;
