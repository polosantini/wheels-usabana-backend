const TripOfferModel = require('../../infrastructure/database/models/TripOfferModel');
const BookingRequestModel = require('../../infrastructure/database/models/BookingRequestModel');
const UserModel = require('../../infrastructure/database/models/UserModel');
const AuditService = require('../../domain/services/AuditService');
const ModerationNote = require('../../infrastructure/database/models/ModerationNoteModel');
const Evidence = require('../../infrastructure/database/models/EvidenceModel');
const AuditLogModel = require('../../infrastructure/database/models/AuditLogModel');
const AuditAnchor = require('../../infrastructure/database/models/AuditAnchorModel');

// Domain services & repositories used for cascade operations
const TripOfferService = require('../../domain/services/TripOfferService');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const MongoSeatLedgerRepository = require('../../infrastructure/repositories/MongoSeatLedgerRepository');

// Helper: mask email like a***@domain.com
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const local = parts[0];
  const domain = parts[1];
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

// Controller: List users for admin with filters, pagination and optional stats
async function listUsers(req, res, next) {
  try {
    const {
      role,
      status, // not persisted in current model, kept for API compatibility
      search,
      createdFrom,
      createdTo,
      page = '1',
      pageSize = '25',
      sort = '-createdAt'
    } = req.query;

    // Basic validation
    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    if (Number.isNaN(pageNum) || Number.isNaN(pageSizeNum) || pageNum < 1 || pageSizeNum < 1) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Invalid query parameters', correlationId: req.correlationId });
    }

    const query = {};
    if (role) query.role = role;
    // Status is not part of current UserModel; if provided, translate to a simple flag for compatibility
    if (status) {
      if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ code: 'invalid_schema', message: 'Invalid status filter', correlationId: req.correlationId });
      }
      // For now, assume all users are 'active' (no persisted status field)
      if (status === 'suspended') {
        // No users suspended in this simple implementation
        query._id = { $in: [] };
      }
    }

    if (createdFrom || createdTo) {
      query.createdAt = {};
      if (createdFrom) query.createdAt.$gte = new Date(createdFrom);
      if (createdTo) query.createdAt.$lte = new Date(createdTo);
    }

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { firstName: re },
        { lastName: re },
        { corporateEmail: re }
      ];
    }

    const sortObj = {};
    // Support simple -field or field sort
    if (sort) {
      const direction = sort.startsWith('-') ? -1 : 1;
      const field = sort.replace(/^-/, '');
      sortObj[field] = direction;
    } else {
      sortObj.createdAt = -1;
    }

    const skip = (pageNum - 1) * pageSizeNum;

    const [total, docs] = await Promise.all([
      UserModel.countDocuments(query),
      UserModel.find(query)
        .select('firstName lastName corporateEmail role createdAt')
        .sort(sortObj)
        .skip(skip)
        .limit(pageSizeNum)
        .lean()
    ]);

    // For each user, compute masked DTO and optional stats
    const items = await Promise.all(docs.map(async (u) => {
      // Compute stats: tripsPublished (driver) and bookingsMade (passenger)
      const userId = u._id;
      const tripsPublished = await TripOfferModel.countDocuments({ driverId: userId });
      const bookingsMade = await BookingRequestModel.countDocuments({ passengerId: userId });

      return {
        id: userId.toString(),
        name: `${u.firstName} ${u.lastName}`.trim(),
        emailMasked: maskEmail(u.corporateEmail),
        role: u.role || 'passenger',
        status: 'active',
        createdAt: u.createdAt,
        stats: { tripsPublished, bookingsMade }
      };
    }));

    const totalPages = Math.max(1, Math.ceil(total / pageSizeNum));

    res.json({
      items,
      page: pageNum,
      pageSize: pageSizeNum,
      total,
      totalPages,
      requestId: req.correlationId
    });

  } catch (err) {
    next(err);
  }
}

// Exports consolidated at end of file

/**
 * Admin: List trips with filters, pagination and capacity snapshot
 * Filters supported: status, driverId, from (origin.text), to (destination.text), departureFrom, departureTo
 */
/**
 * @openapi
 * /admin/trips:
 *   get:
 *     tags:
 *       - System
 *       - Trip Offers
 *     summary: List trips (admin)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: driverId
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *       - in: query
 *         name: departureFrom
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: departureTo
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of trips with capacity snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TripOfferResponse'
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 requestId:
 *                   type: string
 */
async function listTrips(req, res, next) {
  try {
    const {
      status,
      driverId,
      from,
      to,
      departureFrom,
      departureTo,
      page = '1',
      pageSize = '25',
      sort = '-departureAt'
    } = req.query;

    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    if (Number.isNaN(pageNum) || Number.isNaN(pageSizeNum) || pageNum < 1 || pageSizeNum < 1) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Invalid pagination parameters', correlationId: req.correlationId });
    }

    const query = {};
    if (status) {
      query.status = Array.isArray(status) ? { $in: status } : status;
    }
    if (driverId) {
      // Accept driverId string
      query.driverId = driverId;
    }
    if (from) {
      query['origin.text'] = from;
    }
    if (to) {
      query['destination.text'] = to;
    }
    if (departureFrom || departureTo) {
      query.departureAt = {};
      if (departureFrom) query.departureAt.$gte = new Date(departureFrom);
      if (departureTo) query.departureAt.$lte = new Date(departureTo);
    }

    const sortObj = {};
    if (sort) {
      const direction = sort.startsWith('-') ? -1 : 1;
      const field = sort.replace(/^-/, '');
      sortObj[field] = direction;
    } else {
      sortObj.departureAt = -1;
    }

    const skip = (pageNum - 1) * pageSizeNum;

    // Count total and fetch page
    const [total, docs] = await Promise.all([
      TripOfferModel.countDocuments(query),
      TripOfferModel.find(query)
        .select('driverId origin destination departureAt status totalSeats')
        .sort(sortObj)
        .skip(skip)
        .limit(pageSizeNum)
        .lean()
    ]);

    // For each trip compute allocatedSeats (accepted bookings) and remaining
    const items = await Promise.all(docs.map(async (t) => {
      const tripId = t._id;
      const allocatedSeats = await BookingRequestModel.countDocuments({ tripId, status: 'accepted' });
      const totalSeats = t.totalSeats || 0;
      const remainingSeats = Math.max(0, totalSeats - allocatedSeats);

      return {
        id: tripId.toString(),
        driverId: t.driverId ? t.driverId.toString() : null,
        route: { from: t.origin && t.origin.text ? t.origin.text : '', to: t.destination && t.destination.text ? t.destination.text : '' },
        departureAt: t.departureAt ? new Date(t.departureAt).toISOString() : null,
        status: t.status,
        capacity: { totalSeats, allocatedSeats, remainingSeats }
      };
    }));

    const totalPages = Math.max(1, Math.ceil(total / pageSizeNum));

    res.json({ items, page: pageNum, pageSize: pageSizeNum, total, totalPages, requestId: req.correlationId });
  } catch (err) {
    next(err);
  }
}

// Exports consolidated at end of file

// Helper: mask name like J*** D***
function maskName(firstName, lastName) {
  const mask = (s) => {
    if (!s || s.length === 0) return '';
    const first = s[0];
    return `${first}***`;
  };
  return `${mask(firstName)} ${mask(lastName)}`.trim();
}

/**
 * Admin: List bookings with filters, pagination and optional transaction summary
 */
async function listBookings(req, res, next) {
  try {
    const {
      tripId,
      passengerId,
      status,
      paid,
      createdFrom,
      createdTo,
      page = '1',
      pageSize = '25',
      sort = '-createdAt'
    } = req.query;

    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    if (Number.isNaN(pageNum) || Number.isNaN(pageSizeNum) || pageNum < 1 || pageSizeNum < 1) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Invalid pagination parameters', correlationId: req.correlationId });
    }

    const query = {};
    if (tripId) query.tripId = tripId;
    if (passengerId) query.passengerId = passengerId;
    if (status) query.status = Array.isArray(status) ? { $in: status } : status;
    if (typeof paid !== 'undefined') {
      if (paid === 'true' || paid === true) query.isPaid = true;
      else if (paid === 'false' || paid === false) query.isPaid = false;
    }
    if (createdFrom || createdTo) {
      query.createdAt = {};
      if (createdFrom) query.createdAt.$gte = new Date(createdFrom);
      if (createdTo) query.createdAt.$lte = new Date(createdTo);
    }

    const sortObj = {};
    if (sort) {
      const direction = sort.startsWith('-') ? -1 : 1;
      const field = sort.replace(/^-/, '');
      sortObj[field] = direction;
    } else {
      sortObj.createdAt = -1;
    }

    const skip = (pageNum - 1) * pageSizeNum;

    const [total, docs] = await Promise.all([
      BookingRequestModel.countDocuments(query),
      BookingRequestModel.find(query)
        .populate('passengerId', 'firstName lastName')
        .sort(sortObj)
        .skip(skip)
        .limit(pageSizeNum)
        .lean()
    ]);

    // For transaction lookup, query payments collection if present
    const db = require('mongoose').connection.db;

    const items = await Promise.all(docs.map(async (b) => {
      const passenger = b.passengerId || null;
      const passengerDto = passenger ? { id: passenger._id.toString(), name: maskName(passenger.firstName, passenger.lastName) } : null;

      // Try to find a transaction in the 'payments' collection linked by bookingRequestId or bookingId
      let txn = null;
      try {
        if (db && b._id) {
          const paymentsColl = db.collection('payments');
          const found = await paymentsColl.findOne({ bookingRequestId: b._id });
          if (found) {
            txn = {
              id: (found._id || found.id).toString(),
              amount: found.amount || null,
              currency: found.currency || null,
              status: found.status || null,
              refundedAmount: found.refundedAmount || 0
            };
          }
        }
      } catch (e) {
        // ignore transaction lookup errors
      }

      return {
        id: b._id.toString(),
        tripId: b.tripId ? b.tripId.toString() : null,
        passenger: passengerDto,
        status: b.status,
        seats: b.seats || 0,
        transaction: txn
      };
    }));

    const totalPages = Math.max(1, Math.ceil(total / pageSizeNum));

    res.json({ items, page: pageNum, pageSize: pageSizeNum, total, totalPages, requestId: req.correlationId });
  } catch (err) {
    next(err);
  }
}

// Exports consolidated at end of file

/**
 * PATCH /admin/users/:id/suspension
 * Body: { action: 'suspend'|'unsuspend', reason: string }
 */
async function suspendUser(req, res, next) {
  try {
    const userId = req.params.id;
    const { action, reason } = req.body || {};

    if (!action || !['suspend', 'unsuspend'].includes(action) || !reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Missing or invalid action/reason', correlationId: req.correlationId });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ code: 'not_found', message: 'User not found', correlationId: req.correlationId });
    }

    const adminId = req.user && req.user.id ? req.user.id : null;

    if (action === 'suspend') {
      // Idempotent: if already suspended, return current state
      if (user.suspended) {
        // Still create an audit entry for the admin attempt
    await res.audit({ actor: { type: 'admin', id: adminId }, action: 'suspend_attempt', entity: { type: 'User', id: userId }, reason, delta: { before: { suspended: true }, after: { suspended: true } }, correlationId: req.correlationId });
        return res.json({ userId: userId.toString(), status: 'suspended', suspendedAt: user.suspendedAt ? new Date(user.suspendedAt).toISOString() : new Date().toISOString(), by: adminId });
      }

      const before = { suspended: !!user.suspended, suspendedAt: user.suspendedAt, suspensionReason: user.suspensionReason };
      user.suspended = true;
      user.suspendedAt = new Date();
      user.suspendedBy = adminId;
      user.suspensionReason = reason;
      await user.save();

      const after = { suspended: user.suspended, suspendedAt: user.suspendedAt, suspensionReason: user.suspensionReason };
  await res.audit({ actor: { type: 'admin', id: adminId }, action: 'suspend', entity: { type: 'User', id: userId }, reason, delta: { before, after }, correlationId: req.correlationId });

      return res.json({ userId: userId.toString(), status: 'suspended', suspendedAt: user.suspendedAt.toISOString(), by: adminId });
    }

    // unsuspend
    if (!user.suspended) {
      // idempotent no-op
  await res.audit({ actor: { type: 'admin', id: adminId }, action: 'unsuspend_attempt', entity: { type: 'User', id: userId }, reason, delta: { before: { suspended: false }, after: { suspended: false } }, correlationId: req.correlationId });
      return res.json({ userId: userId.toString(), status: 'active', by: adminId });
    }

    const beforeU = { suspended: true, suspendedAt: user.suspendedAt, suspensionReason: user.suspensionReason };
    user.suspended = false;
    user.suspendedAt = null;
    user.suspendedBy = adminId;
    user.suspensionReason = '';
    await user.save();
    const afterU = { suspended: false, suspendedAt: null, suspensionReason: '' };
  await res.audit({ actor: { type: 'admin', id: adminId }, action: 'unsuspend', entity: { type: 'User', id: userId }, reason, delta: { before: beforeU, after: afterU }, correlationId: req.correlationId });

    return res.json({ userId: userId.toString(), status: 'active', by: adminId });

  } catch (err) {
    next(err);
  }
}

module.exports.suspendUser = suspendUser;


/**
 * PATCH /admin/drivers/:driverId/publish-ban
 * Body: { banUntil: ISODate|null, reason: string }
 * Sets or clears a temporary publish ban for drivers. Requires admin role.
 */
async function publishBan(req, res, next) {
  try {
    const driverId = req.params.driverId;
    const { banUntil, reason } = req.body || {};

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Missing reason', correlationId: req.correlationId });
    }

    const user = await UserModel.findById(driverId);
    if (!user || user.role !== 'driver') {
      return res.status(404).json({ code: 'not_found', message: 'Driver not found', correlationId: req.correlationId });
    }

    const adminId = req.user && req.user.id ? req.user.id : null;

    const before = { publishBanUntil: user.publishBanUntil || null };

    user.publishBanUntil = banUntil ? new Date(banUntil) : null;
    user.publishBanReason = reason || '';
    user.publishBannedBy = adminId;

    await user.save();

    const after = { publishBanUntil: user.publishBanUntil || null };

  await res.audit({ actor: { type: 'admin', id: adminId }, action: 'publish_ban', entity: { type: 'User', id: driverId }, reason, delta: { before, after }, correlationId: req.correlationId });

    return res.json({ driverId: driverId.toString(), banUntil: user.publishBanUntil ? user.publishBanUntil.toISOString() : null, by: adminId });
  } catch (err) {
    next(err);
  }
}

module.exports.publishBan = publishBan;


/**
 * POST /admin/trips/:tripId/force-cancel
 * Body: { reason: string }
 * Admin override: force-cancel any trip and cascade to bookings.
 */
async function forceCancelTrip(req, res, next) {
  try {
    const tripId = req.params.tripId;
    const { reason } = req.body || {};

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Missing cancellation reason', correlationId: req.correlationId });
    }

    // Find trip
    const trip = await TripOfferModel.findById(tripId);
    if (!trip) {
      return res.status(404).json({ code: 'not_found', message: 'Trip not found', correlationId: req.correlationId });
    }

    // Prepare service and repositories
    // Perform non-transactional cascade (safer for test environments without replica sets)
    const bookingRequestRepository = new MongoBookingRequestRepository();
    const seatLedgerRepository = new MongoSeatLedgerRepository();

    try {
      // a) Update trip status to canceled
      await TripOfferModel.findByIdAndUpdate(tripId, { status: 'canceled', updatedAt: new Date() });

      // b) Query bookings before mutation
      const pendingBookings = await bookingRequestRepository.findAllPendingByTrip(tripId);
      const acceptedBookings = await bookingRequestRepository.findAllAcceptedByTrip(tripId);

      // c) Bulk decline pending bookings
      const declinedAuto = pendingBookings.length > 0 ? await bookingRequestRepository.bulkDeclineAuto(tripId) : 0;

      // d) Compute seats to release and cancel accepted bookings
      const totalSeatsToRelease = acceptedBookings.reduce((s, b) => s + (b.seats || 0), 0);
      const canceledByPlatform = acceptedBookings.length > 0 ? await bookingRequestRepository.bulkCancelByPlatform(tripId) : 0;

      // e) Deallocate seats from ledger (if any)
      let ledgerReleased = 0;
      if (totalSeatsToRelease > 0) {
        const ledgerResult = await seatLedgerRepository.deallocateSeats(tripId, totalSeatsToRelease);
        if (ledgerResult) {
          ledgerReleased = acceptedBookings.length; // count of bookings
        } else {
          // Log and continue; refund flags were set by bulkCancelByPlatform
          console.warn(`[adminController] Could not deallocate seats for trip ${tripId}`);
        }
      }

      // f) For now, refundsCreated is the count of canceled bookings (payment service handles actual refunds)
      const refundsCreated = canceledByPlatform;

      const effects = {
        declinedAuto: declinedAuto || 0,
        canceledByPlatform: canceledByPlatform || 0,
        refundsCreated: refundsCreated || 0,
        ledgerReleased: ledgerReleased || 0
      };

      // Record audit entry summarizing effects
      const adminId = req.user && req.user.id ? req.user.id : null;
      const before = { status: trip.status };
      const after = { status: 'canceled' };

  await res.audit({ actor: { type: 'admin', id: adminId }, action: 'force_cancel_trip', entity: { type: 'TripOffer', id: tripId.toString() }, reason, delta: { before, after }, correlationId: req.correlationId, meta: { effects } });

      // Respond
      return res.json({ tripId: tripId.toString(), status: 'canceled', effects });
    } catch (err) {
      console.error('[adminController] Force-cancel failed:', err && err.message);
      return res.status(500).json({ code: 'domain', message: 'Failed to cancel trip atomically', correlationId: req.correlationId });
    }
  } catch (err) {
    next(err);
  }
}

module.exports.forceCancelTrip = forceCancelTrip;

/**
 * Admin: List refunds with filters and pagination
 * Filters: status, reason, transactionId, bookingId, createdFrom, createdTo
 */
async function listRefunds(req, res, next) {
  try {
    const {
      status,
      reason,
      transactionId,
      bookingId,
      createdFrom,
      createdTo,
      page = '1',
      pageSize = '25',
      sort = '-createdAt'
    } = req.query;

    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    if (Number.isNaN(pageNum) || Number.isNaN(pageSizeNum) || pageNum < 1 || pageSizeNum < 1) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Invalid pagination parameters', correlationId: req.correlationId });
    }

    const db = require('mongoose').connection.db;
    const coll = db.collection('refunds');

    const query = {};
    if (status) query.status = status;
    if (reason) query.reason = reason;
    if (transactionId) query.transactionId = transactionId;
    if (bookingId) query.bookingRequestId = bookingId;
    if (createdFrom || createdTo) {
      query.createdAt = {};
      if (createdFrom) query.createdAt.$gte = new Date(createdFrom);
      if (createdTo) query.createdAt.$lte = new Date(createdTo);
    }

    // Count and fetch
    const total = await coll.countDocuments(query);

    // Build sort
    const sortObj = {};
    if (sort) {
      const dir = sort.startsWith('-') ? -1 : 1;
      const field = sort.replace(/^-/, '');
      sortObj[field] = dir;
    } else {
      sortObj.createdAt = -1;
    }

    const skip = (pageNum - 1) * pageSizeNum;

    const docs = await coll.find(query).sort(sortObj).skip(skip).limit(pageSizeNum).toArray();

    const items = docs.map(d => ({
      id: (d._id || d.id).toString(),
      transactionId: d.transactionId || null,
      bookingId: d.bookingRequestId ? (d.bookingRequestId.toString ? d.bookingRequestId.toString() : d.bookingRequestId) : null,
      amount: d.amount || null,
      currency: d.currency || null,
      status: d.status || null,
      reason: d.reason || null,
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null
    }));

    const totalPages = Math.max(1, Math.ceil(total / pageSizeNum));
    res.json({ items, page: pageNum, pageSize: pageSizeNum, total, totalPages, requestId: req.correlationId });
  } catch (err) {
    next(err);
  }
}

/**
 * @openapi
 * /admin/bookings:
 *   get:
 *     tags:
 *       - System
 *       - Trip Offers
 *     summary: List bookings (admin)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: tripId
 *         schema:
 *           type: string
 *       - in: query
 *         name: passengerId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: paid
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of bookings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       tripId:
 *                         type: string
 *                       passenger:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                       status:
 *                         type: string
 *                       seats:
 *                         type: integer
 *                       transaction:
 *                         type: object
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 requestId:
 *                   type: string
 */

/**
 * @openapi
 * /admin/refunds:
 *   get:
 *     tags:
 *       - System
 *       - Trip Offers
 *     summary: List refunds (admin)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: transactionId
 *         schema:
 *           type: string
 *       - in: query
 *         name: bookingId
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of refunds
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       transactionId:
 *                         type: string
 *                       bookingId:
 *                         type: string
 *                       amount:
 *                         type: number
 *                       currency:
 *                         type: string
 *                       status:
 *                         type: string
 *                       reason:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 requestId:
 *                   type: string
 */

module.exports = { listUsers, listTrips, listBookings, listRefunds, suspendUser, forceCancelTrip, publishBan, correctBookingState };

/**
 * POST /admin/moderation/evidence/upload-url
 * Body: { filename, contentType }
 * Returns a short-lived upload URL and evidenceId
 */
async function createEvidenceUploadUrl(req, res, next) {
  try {
    const { filename, contentType } = req.body || {};
    const crypto = require('crypto');
    const evidenceId = `ev_${crypto.randomBytes(4).toString('hex')}`;
    const uploadToken = crypto.randomBytes(24).toString('hex');
    const ttlSeconds = 60;
    const uploadExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Store record
    await Evidence.create({ evidenceId, filename, contentType, uploadToken, uploadExpiresAt, createdAt: new Date() });

    // For this implementation return an internal upload URL that the client can call (stub)
    const uploadUrl = `${req.protocol}://${req.get('host')}/internal/moderation/evidence/upload/${uploadToken}`;

    return res.status(200).json({ evidenceId, uploadUrl, expiresInSeconds: ttlSeconds });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/moderation/notes
 * Create a moderation note referencing an entity and optional evidence ids
 */
async function createModerationNote(req, res, next) {
  try {
    const { entity, entityId, category, reason, evidence } = req.body || {};
    const adminId = req.user && (req.user.sub || req.user.id) ? (req.user.sub || req.user.id) : null;

    // Basic entity existence checks
    if (entity === 'user') {
      const u = await UserModel.findById(entityId);
      if (!u) return res.status(404).json({ code: 'not_found', message: 'Entity not found', correlationId: req.correlationId });
    }
    if (entity === 'trip') {
      const TripOfferModel = require('../../infrastructure/database/models/TripOfferModel');
      const t = await TripOfferModel.findById(entityId);
      if (!t) return res.status(404).json({ code: 'not_found', message: 'Entity not found', correlationId: req.correlationId });
    }
    if (entity === 'booking') {
      const BookingRequestModel = require('../../infrastructure/database/models/BookingRequestModel');
      const b = await BookingRequestModel.findById(entityId);
      if (!b) return res.status(404).json({ code: 'not_found', message: 'Entity not found', correlationId: req.correlationId });
    }

    // Defensive: ensure evidence ids exist (if provided)
    if (Array.isArray(evidence) && evidence.length > 0) {
      const found = await Evidence.find({ evidenceId: { $in: evidence } }).select('evidenceId').lean();
      const foundIds = (found || []).map(f => f.evidenceId);
      const missing = evidence.filter(e => !foundIds.includes(e));
      if (missing.length > 0) return res.status(400).json({ code: 'invalid_schema', message: 'Unknown evidence ids', correlationId: req.correlationId });
    }

    const note = await ModerationNote.create({ entity, entityId, category, reason, evidence: evidence || [], createdBy: adminId, createdAt: new Date() });

  // Audit the creation
  await res.audit({ actor: { type: 'admin', id: adminId }, action: 'create_moderation_note', entity: { type: 'ModerationNote', id: note._id.toString() }, reason, delta: { before: null, after: { entity, entityId, category, reason, evidence } }, correlationId: req.correlationId });

    return res.status(201).json({ noteId: note._id.toString(), entity: { type: entity, id: entityId }, category, reason, createdAt: note.createdAt.toISOString(), by: adminId });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/moderation/notes?entity=...&entityId=...&page=&pageSize=
 */
async function listModerationNotes(req, res, next) {
  try {
    const { entity, entityId, page = 1, pageSize = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);

    const query = { entity, entityId };
    const total = await ModerationNote.countDocuments(query);
    const docs = await ModerationNote.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * pageSizeNum).limit(pageSizeNum).lean();

    const items = docs.map(d => ({ noteId: d._id.toString(), category: d.category, reason: d.reason, createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null, by: d.createdBy }));

    return res.status(200).json({ items, page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.max(1, Math.ceil(total / pageSizeNum)) });
  } catch (err) {
    next(err);
  }
}

module.exports.createEvidenceUploadUrl = createEvidenceUploadUrl;
module.exports.createModerationNote = createModerationNote;
module.exports.listModerationNotes = listModerationNotes;

/**
 * GET /admin/audit
 * Paginated audit listing for admins.
 */
async function listAudit(req, res, next) {
  try {
    const {
      entity, entityId, who, actorId, actorType, action, entityType, correlationId, from, to, page = 1, pageSize = 50, sort = '-ts'
    } = req.query;
    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);

    // build Mongo query supporting both new (entity.type/entity.id) and legacy (entity/entityId/who) shapes
    const and = [];
    if (action) {
      const safe = action.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
      and.push({ action: { $regex: `^${safe}` } });
    }
    // actor filters (support new actor.id and legacy who)
    if (who) and.push({ $or: [ { 'actor.id': who }, { who: who } ] });
    if (actorId) and.push({ $or: [ { 'actor.id': actorId }, { who: actorId } ] });
    if (actorType) and.push({ 'actor.type': actorType });
    // entity filters (support new entity.type/entity.id and legacy entity/entityId)
    if (entity) and.push({ $or: [ { 'entity.type': entity }, { entity: entity } ] });
    if (entityType) and.push({ $or: [ { 'entity.type': entityType }, { entity: entityType } ] });
    if (entityId) and.push({ $or: [ { 'entity.id': entityId }, { entityId: entityId } ] });
    if (correlationId) and.push({ correlationId });
    if (from || to) {
      const range = {};
      if (from) range.$gte = new Date(from);
      if (to) range.$lte = new Date(to);
      and.push({ ts: range });
    }

    const query = and.length > 0 ? { $and: and } : {};

    const total = await AuditLogModel.countDocuments(query);

    // sorting
    const sortObj = {};
    if (sort) {
      const dir = sort.startsWith('-') ? -1 : 1;
      const field = sort.replace(/^-/, '');
      // map friendly field names
      const mapped = field === 'ts' ? 'ts' : field;
      sortObj[mapped] = dir;
    } else {
      sortObj.ts = -1;
    }

    const docs = await AuditLogModel.find(query).sort(sortObj).skip((pageNum - 1) * pageSizeNum).limit(pageSizeNum).lean();

    // redact PII in delta/what using structuredLogger.redactPII
    const { redactPII } = require('../middlewares/structuredLogger');

    const items = docs.map(d => {
      const out = {
        id: (d._id || d.id).toString(),
        ts: d.ts ? new Date(d.ts).toISOString() : null,
        actor: d.actor || null,
        action: d.action || null,
        entity: d.entity || null,
        reason: d.reason || null,
        delta: redactPII(d.delta || d.what || null),
        correlationId: d.correlationId || null,
        prevHash: d.prevHash || null,
        hash: d.hash || null
      };
      return out;
    });

    return res.status(200).json({ items, page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.max(1, Math.ceil(total / pageSizeNum)) });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/audit/export
 * Streams matching audit entries as NDJSON (newline-delimited JSON).
 */
async function exportAudit(req, res, next) {
  try {
    const { entity, entityId, who, actorId, actorType, action, entityType, correlationId, from, to } = req.query;

  // Support optional from/to. If omitted, export entire range.
  let fromDate;
  let toDate;
  // Support both Joi-coerced Date objects and string date inputs (YYYY-MM-DD)
  if (!from || !to) {
    fromDate = new Date(0);
    toDate = new Date();
  } else {
    fromDate = (from instanceof Date) ? new Date(new Date(from).toISOString().slice(0,10) + 'T00:00:00.000Z') : new Date(`${from}T00:00:00.000Z`);
    toDate = (to instanceof Date) ? new Date(new Date(to).toISOString().slice(0,10) + 'T23:59:59.999Z') : new Date(`${to}T23:59:59.999Z`);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Invalid date range', correlationId: req.correlationId });
    }
  }

    // Build flexible query supporting legacy and new shapes
    const and = [];
    if (action) {
      const safe = action.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
      and.push({ action: { $regex: `^${safe}` } });
    }
    if (actorId) {
      and.push({ $or: [ { 'actor.id': actorId }, { who: actorId } ] });
    } else if (who) {
      and.push({ $or: [ { 'actor.id': who }, { who: who } ] });
    }
    if (actorType) and.push({ 'actor.type': actorType });
    if (entityType) and.push({ $or: [ { 'entity.type': entityType }, { entity: entityType } ] });
    if (entityId) and.push({ $or: [ { 'entity.id': entityId }, { entityId: entityId } ] });
    if (correlationId) and.push({ correlationId });

    // time range matches either ts or when fields
    and.push({ $or: [ { ts: { $gte: fromDate, $lte: toDate } }, { when: { $gte: fromDate, $lte: toDate } } ] });

    const query = and.length > 0 ? { $and: and } : {};

  // Response headers and filename: include requested range
  res.setHeader('Content-Type', 'application/x-ndjson');
  const fromKey = (from instanceof Date) ? new Date(from).toISOString().slice(0,10) : String(from);
  const toKey = (to instanceof Date) ? new Date(to).toISOString().slice(0,10) : String(to);
  const filename = `audit-${fromKey}_${toKey}.ndjson`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Prevent server-side timeouts for long exports
    if (res.setTimeout) res.setTimeout(0);

    const cursor = AuditLogModel.find(query).sort({ ts: 1, when: 1 }).cursor();
    const { redactPII } = require('../middlewares/structuredLogger');

    cursor.on('data', (doc) => {
      const tsVal = doc.ts || doc.when || null;
      const tsIso = tsVal ? (tsVal instanceof Date ? tsVal.toISOString() : new Date(tsVal).toISOString()) : null;

      const actor = doc.actor && typeof doc.actor === 'object' ? doc.actor : (doc.who ? { type: null, id: doc.who } : null);
      const entityObj = (doc.entity && typeof doc.entity === 'object') ? doc.entity : { type: doc.entity || null, id: doc.entityId || null };

      const out = {
        id: doc._id.toString(),
        ts: tsIso,
        actor,
        action: doc.action,
        entity: entityObj,
        reason: doc.reason || doc.why || null,
        delta: redactPII(doc.delta || doc.what || null),
        correlationId: doc.correlationId || null,
        prevHash: doc.prevHash || null,
        hash: doc.hash || null
      };

      res.write(JSON.stringify(out) + '\n');
    });
    cursor.on('end', () => {
      res.end();
    });
    cursor.on('error', (err) => {
      console.error('[adminController] exportAudit cursor error', err && err.message);
      next(err);
    });

  } catch (err) {
    next(err);
  }
}

module.exports.listAudit = listAudit;
module.exports.exportAudit = exportAudit;

/**
 * GET /admin/audit/integrity?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Verify chain integrity and daily anchors for given inclusive date range
 */
async function verifyIntegrity(req, res, next) {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ code: 'invalid_schema', message: 'Missing from/to', correlationId: req.correlationId });

    const AuditService = require('../../domain/services/AuditService');
    const result = await AuditService.verifyIntegrity({ from, to });

    return res.status(200).json({ range: { from, to }, verified: result.verified, breaks: result.breaks });
  } catch (err) {
    next(err);
  }
}

module.exports.verifyIntegrity = verifyIntegrity;


/**
 * POST /admin/bookings/:bookingId/correct-state
 * Body: { targetState: 'declined_by_admin'|'canceled_by_platform', refund?: { amount, reason }, reason }
 */
async function correctBookingState(req, res, next) {
  try {
    const bookingId = req.params.bookingId;
    const { targetState, refund, reason } = req.body || {};

    if (!targetState || !reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ code: 'invalid_schema', message: 'Missing targetState or reason', correlationId: req.correlationId });
    }

    const bookingRepo = new MongoBookingRequestRepository();
    const seatLedgerRepo = new MongoSeatLedgerRepository();

    const booking = await bookingRepo.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ code: 'not_found', message: 'Booking not found', correlationId: req.correlationId });
    }

    const oldStatus = booking.status;

    // Allowed transitions
    if (targetState === 'declined_by_admin') {
      if (oldStatus !== 'pending') {
        return res.status(409).json({ code: 'invalid_state', message: 'Transition not permitted', correlationId: req.correlationId });
      }

      // Perform admin decline
      const adminId = req.user && req.user.id ? req.user.id : null;
      const updated = await bookingRepo.adminDecline(bookingId, adminId, reason);

  await res.audit({ actor: { type: 'admin', id: adminId }, action: 'correct_booking_state', entity: { type: 'BookingRequest', id: bookingId }, reason, delta: { before: { status: oldStatus }, after: { status: updated.status } }, correlationId: req.correlationId });

      return res.json({ bookingId, oldStatus, newStatus: updated.status, effects: { ledgerReleased: 0, refundCreated: false } });
    }

    if (targetState === 'canceled_by_platform') {
      if (oldStatus !== 'accepted') {
        return res.status(409).json({ code: 'invalid_state', message: 'Transition not permitted', correlationId: req.correlationId });
      }

      // If refund is requested, validate refundable balance from payments collection
      const db = require('mongoose').connection.db;
      let refundCreated = false;

      if (refund) {
        try {
          const paymentsColl = db.collection('payments');
          const payment = await paymentsColl.findOne({ bookingRequestId: bookingId });
          if (!payment) {
            return res.status(400).json({ code: 'invalid_schema', message: 'No refundable balance', correlationId: req.correlationId });
          }
          const refundedAmount = payment.refundedAmount || 0;
          const remaining = (payment.amount || 0) - refundedAmount;
          if (refund.amount > remaining) {
            return res.status(400).json({ code: 'invalid_schema', message: 'Refund amount exceeds refundable balance', correlationId: req.correlationId });
          }
        } catch (err) {
          // If payments lookup fails, return schema error
          return res.status(400).json({ code: 'invalid_schema', message: 'Unable to validate refund', correlationId: req.correlationId });
        }
      }

      // Perform transactional cancel-by-platform
      const bookingEntity = booking; // domain entity returned by repo
      let updatedBooking;
      try {
        updatedBooking = await bookingRepo.cancelByPlatformWithTransaction(bookingEntity, seatLedgerRepo);
      } catch (err) {
        // Map transaction errors
        console.error('[adminController] cancelByPlatform failed:', err && err.message);
        return res.status(500).json({ code: 'domain', message: 'Failed to apply correction atomically', correlationId: req.correlationId });
      }

      // Create refund record if requested
      if (refund) {
        const coll = db.collection('refunds');
        try {
          await coll.insertOne({
            bookingRequestId: bookingId,
            amount: refund.amount,
            currency: refund.currency || 'COP',
            reason: refund.reason || refund.reason,
            status: 'created',
            createdAt: new Date()
          });
          refundCreated = true;
        } catch (err) {
          console.error('[adminController] Failed to create refund record:', err && err.message);
        }
      }

    // Audit
    const adminId = req.user && req.user.id ? req.user.id : null;
    await res.audit({ actor: { type: 'admin', id: adminId }, action: 'correct_booking_state', entity: { type: 'BookingRequest', id: bookingId }, reason, delta: { before: { status: oldStatus }, after: { status: updatedBooking.status } }, correlationId: req.correlationId });

      const effects = { ledgerReleased: bookingEntity.seats || 0, refundCreated };
      return res.json({ bookingId, oldStatus, newStatus: updatedBooking.status, effects });
    }

    return res.status(400).json({ code: 'invalid_schema', message: 'Invalid targetState', correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
}

module.exports.correctBookingState = correctBookingState;
