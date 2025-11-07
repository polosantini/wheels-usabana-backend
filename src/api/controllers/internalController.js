/**
 * InternalController
 * 
 * Admin-only endpoints for system operations:
 * - Manual job triggers for QA/testing
 * - System health checks
 * - Maintenance tasks
 * 
 * All endpoints require ADMIN role and JWT authentication.
 */

const LifecycleJobService = require('../../domain/services/LifecycleJobService');
const LifecycleJobResultDto = require('../../domain/dtos/LifecycleJobResultDto');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const MongoVehicleRepository = require('../../infrastructure/repositories/MongoVehicleRepository');
const MongoUserRepository = require('../../infrastructure/repositories/MongoUserRepository');
const UserModel = require('../../infrastructure/database/models/UserModel');
const NotificationTemplateService = require('../../domain/services/NotificationTemplateService');
const InAppNotification = require('../../infrastructure/database/models/InAppNotificationModel');
const NotificationDelivery = require('../../infrastructure/database/models/NotificationDeliveryModel');
const notificationMetrics = require('../../domain/services/notificationMetrics');
const { v4: uuidv4 } = require('uuid');
const DriverVerification = require('../../infrastructure/database/models/DriverVerificationModel');
const verificationExpiryService = require('../../domain/services/verificationExpiryService');
const DocumentPreview = require('../../infrastructure/database/models/DocumentPreviewModel');

class InternalController {
  constructor() {
    // Initialize repositories
    this.tripOfferRepository = new MongoTripOfferRepository();
    this.bookingRequestRepository = new MongoBookingRequestRepository();
    this.vehicleRepository = new MongoVehicleRepository();
    this.userRepository = new MongoUserRepository();

    // Initialize lifecycle job service
    this.lifecycleJobService = new LifecycleJobService(
      this.tripOfferRepository,
      this.bookingRequestRepository,
      this.vehicleRepository,
      this.userRepository
    );

    // Template renderer for admin preview
    this.templateService = new NotificationTemplateService();
  }

  /**
   * POST /internal/jobs/run?name=complete-trips
   * 
   * Manually trigger lifecycle jobs (US-3.4.4)
   * 
   * Admin-only endpoint for:
   * - QA/testing
   * - Manual intervention
   * - Immediate cleanup
   * 
   * Jobs:
   * - complete-trips: Auto-complete trips + expire pending bookings
   * - auto-complete-trips: Only complete trips
   * - expire-pendings: Only expire bookings
   * 
   * Query params:
   * - name: Job name (required)
   * - pendingTtlHours: TTL for pending bookings (optional, default: 48)
   * 
   * Response:
   * - 200: Job executed with metrics
   * - 400: Invalid job name
   * - 403: Not admin
   */
  async runLifecycleJob(req, res, next) {
    try {
      const { name = 'complete-trips', pendingTtlHours = 48 } = req.query;
      const adminId = req.user.sub;

      console.log(
        `[InternalController] Manual job trigger | name: ${name} | adminId: ${adminId} | pendingTtlHours: ${pendingTtlHours} | correlationId: ${req.correlationId}`
      );

      let result;

      switch (name) {
        case 'complete-trips':
          // Run both auto-complete and expire jobs
          result = await this.lifecycleJobService.runCompleteTripsJob({
            pendingTtlHours: parseInt(pendingTtlHours, 10)
          });
          break;

        case 'auto-complete-trips':
          // Only auto-complete trips
          result = await this.lifecycleJobService.runAutoCompleteTripsOnly();
          break;

        case 'expire-pendings':
          // Only expire pending bookings
          result = await this.lifecycleJobService.runExpirePendingsOnly(
            parseInt(pendingTtlHours, 10)
          );
          break;

        case 'verification-expiry-scan':
          // Run driver verification expiry scan and reminders
          try {
            result = await verificationExpiryService.runExpiryScan({ windowsDays: [30,7,1] });
            // normalize to expected DTO shape
            result = {
              processed: result.processed,
              newlyExpired: result.newlyExpired,
              remindersSent: result.remindersSent
            };
          } catch (e) {
            console.error('[InternalController] verification-expiry-scan failed', e);
            return res.status(500).json({ code: 'server_error', message: 'verification expiry scan failed', correlationId: req.correlationId });
          }
          break;

        case 'audit-anchor':
          try {
            const AuditService = require('../../domain/services/AuditService');
            const dateKey = req.query.date || null;
            result = await AuditService.generateDailyAnchor({ dateKey });
          } catch (e) {
            console.error('[InternalController] audit-anchor failed', e);
            return res.status(500).json({ code: 'server_error', message: 'audit anchor generation failed', correlationId: req.correlationId });
          }
          break;

        default:
          console.log(
            `[InternalController] Invalid job name | name: ${name} | correlationId: ${req.correlationId}`
          );
          return res.status(400).json({
            code: 'invalid_job_name',
            message: `Invalid job name: ${name}. Valid names: complete-trips, auto-complete-trips, expire-pendings`,
            correlationId: req.correlationId
          });
      }

      // Special-case: verification-expiry-scan returns a different shape
      if (name === 'verification-expiry-scan') {
        console.log(
          `[InternalController] Job completed | name: ${name} | newlyExpired: ${result.newlyExpired} | remindersSent: ${result.remindersSent} | correlationId: ${req.correlationId}`
        );
        return res.status(200).json(result);
      }

      // Map to DTO for lifecycle jobs that use the lifecycle DTO shape
      const responseDto = LifecycleJobResultDto.fromJobResult(result);

      console.log(
        `[InternalController] Job completed | name: ${name} | completedTrips: ${result.completedTrips} | expiredPendings: ${result.expiredPendings} | correlationId: ${req.correlationId}`
      );

      res.status(200).json(responseDto);
    } catch (error) {
      console.error(
        `[InternalController] Job execution failed | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      next(error);
    }
  }

  /**
   * POST /internal/notifications/templates/render
   * Admin-only preview of templates. Read-only.
   */
  async renderTemplate(req, res, next) {
    try {
      const { channel, type, variables, locale = 'en' } = req.body;
      console.log(`[InternalController] Template preview requested | type: ${type} | channel: ${channel} | locale: ${locale} | adminId: ${req.user.sub} | correlationId: ${req.correlationId}`);

      let rendered;
      try {
        rendered = await this.templateService.render(channel, type, variables, locale, { sanitize: true, inlineCss: false });
      } catch (err) {
        // expected errors from renderer come as { code, message }
        if (err && err.code && err.message) {
          return res.status(400).json({ code: err.code, message: err.message, correlationId: req.correlationId });
        }
        throw err;
      }

      if (!rendered) {
        return res.status(400).json({ code: 'invalid_schema', message: 'Unsupported template type or missing variables', correlationId: req.correlationId });
      }

      // Standardize response shape: { subject, html, text }
      res.status(200).json(rendered);
    } catch (error) {
      console.error(`[InternalController] Template preview failed | error: ${error.message} | correlationId: ${req.correlationId}`);
      next(error);
    }
  }

  /**
   * POST /internal/notifications/templates/validate
   * Admin-only: Validate a draft template payload. No persistence.
   */
  async validateTemplate(req, res, next) {
    try {
      const draft = req.body;
      console.log(`[InternalController] Template validate requested | type: ${draft.type} | locale: ${draft.locale} | adminId: ${req.user.sub} | correlationId: ${req.correlationId}`);

      const templateRegistry = require('../../domain/services/templateRegistry');

      const result = templateRegistry.validateDraft(draft);

      return res.status(200).json({ valid: result.valid, warnings: result.warnings || [] });
    } catch (err) {
      // err is expected to be an object like { code, message }
      console.error(`[InternalController] Template validate failed | error: ${err && err.message ? err.message : err} | correlationId: ${req.correlationId}`);
      if (err && err.code && err.message) {
        return res.status(400).json({ code: err.code, message: err.message, correlationId: req.correlationId });
      }
      next(err);
    }
  }

  /**
   * POST /internal/notifications/dispatch
   * Admin-only: force-create an in-app notification and optionally queue an email (stub)
   */
  async dispatchNotification(req, res, next) {
    try {
      const { channel = 'both', type, userId, variables = {} } = req.body;

      // Resolve user preferences (if present) to decide which channels to invoke.
      // Fallback defaults: email=true, inApp=true, push=false
      let userDoc = null;
      try {
        userDoc = await UserModel.findById(userId).lean();
      } catch (e) {
        // ignore lookup errors and treat as no preferences (use defaults)
        userDoc = null;
      }

      const prefs = (userDoc && userDoc.notificationPreferences) || {};
      const channelDefaults = { email: true, inApp: true, push: false };

      const globalChannels = prefs.channels || {};
      const channelEnabledGlobal = {
        email: typeof globalChannels.email === 'boolean' ? globalChannels.email : channelDefaults.email,
        inApp: typeof globalChannels.inApp === 'boolean' ? globalChannels.inApp : channelDefaults.inApp,
        push: typeof globalChannels.push === 'boolean' ? globalChannels.push : channelDefaults.push
      };

      const typePrefs = (prefs.types && prefs.types[type]) || null;
      const shouldSendEmail = typePrefs && typeof typePrefs.email === 'boolean' ? typePrefs.email : channelEnabledGlobal.email;
      const shouldSendInApp = typePrefs && typeof typePrefs.inApp === 'boolean' ? typePrefs.inApp : channelEnabledGlobal.inApp;

      // Create in-app notification if requested AND allowed by preferences
      let createdNotification = null;
      if ((channel === 'in-app' || channel === 'both')) {
        if (!shouldSendInApp) {
          console.info({ userId, type, correlationId: req.correlationId }, 'in_app_channel_skipped_by_preferences');
          try {
            await notificationMetrics.increment({ type, channel: 'inApp', deltas: { skippedByPreferences: 1 } });
          } catch (e) {
            console.warn('[InternalController] metrics increment failed for inApp skippedByPreferences', e);
          }
        } else {
          const title = variables.title || (type === 'payment.succeeded' ? 'Payment received' : 'Notification');
          const body = variables.body || '';
          createdNotification = await InAppNotification.create({
            userId,
            type,
            title,
            body,
            data: variables,
            correlationId: req.correlationId
          });

          // metrics: in-app rendered & delivered/attempted
          try {
            await notificationMetrics.increment({ type, channel: 'inApp', deltas: { rendered: 1, attempted: 1, delivered: 1 } });
          } catch (e) {
            console.warn('[InternalController] metrics increment failed for inApp', e);
          }
        }
      }

      // Simulate email dispatch by creating a NotificationDelivery record (only if allowed by preferences)
      let delivery = null;
      if (channel === 'email' || channel === 'both') {
        if (!shouldSendEmail) {
          console.info({ userId, type, correlationId: req.correlationId }, 'email_channel_skipped_by_preferences');
          try {
            await notificationMetrics.increment({ type, channel: 'email', deltas: { skippedByPreferences: 1 } });
          } catch (e) {
            console.warn('[InternalController] metrics increment failed for email skippedByPreferences', e);
          }
        } else {
          const providerMessageId = uuidv4();
          delivery = await NotificationDelivery.create({
            providerMessageId,
            notificationId: createdNotification ? createdNotification._id : null,
            status: 'pending',
            meta: { intentType: type, queuedBy: req.user.sub }
          });

          // metrics: email rendered & attempted
          try {
            await notificationMetrics.increment({ type, channel: 'email', deltas: { rendered: 1, attempted: 1 } });
          } catch (e) {
            console.warn('[InternalController] metrics increment failed for email', e);
          }
        }
      }

      return res.status(201).json({
        ok: true,
        notification: createdNotification ? { id: createdNotification._id.toString(), type: createdNotification.type, title: createdNotification.title } : null,
        delivery: delivery ? { id: delivery._id.toString(), providerMessageId: delivery.providerMessageId, status: delivery.status } : null
      });
    } catch (error) {
      console.error(`[InternalController] Dispatch failed | error: ${error.message} | correlationId: ${req.correlationId}`);
      next(error);
    }
  }

  /**
   * PATCH /admin/drivers/:driverId/verification
   * Admin reviews a driver's verification profile (approve | reject)
   */
  async reviewDriverVerification(req, res, next) {
    try {
      const adminId = req.user.sub || req.user.id;
      const { driverId } = req.params;
      const { action, reason, comment } = req.body || {};

      console.log(`[InternalController] Review driver verification | driverId: ${driverId} | action: ${action} | adminId: ${adminId} | correlationId: ${req.correlationId}`);

      // Load profile
      const profile = await DriverVerification.findOne({ userId: driverId });
      if (!profile) {
        return res.status(404).json({ code: 'not_found', message: 'Verification profile not found', correlationId: req.correlationId });
      }

      // Only allow from pending_review
      if (profile.status !== 'pending_review') {
        return res.status(409).json({ code: 'invalid_state', message: 'Profile is not pending_review', correlationId: req.correlationId });
      }

      // Validate action body (action validated by middleware schema). Additional business checks:
      const now = new Date();

      // Ensure required docs are present and not expired at decision time
      const missing = [];
      const expired = [];
      const requiredDocs = ['govIdFront','driverLicense','soat'];
      requiredDocs.forEach(k => {
        const d = profile.documents && profile.documents[k];
        if (!d || !d.storagePath) missing.push(k);
        else if (d.expiresAt && new Date(d.expiresAt) < now) expired.push(k);
      });

      if (action === 'approve') {
        if (missing.length > 0 || expired.length > 0) {
          return res.status(400).json({ code: 'invalid_schema', message: `Cannot approve: missing docs: ${missing.join(', ') || 'none'}; expired: ${expired.join(', ') || 'none'}`, correlationId: req.correlationId });
        }

        profile.status = 'verified';
        profile.decisionAt = now;
        profile.reviewedBy = adminId;
        profile.rejectionReason = undefined;
        if (comment) profile.adminNotes = (profile.adminNotes || []).concat([{ adminId, notes: comment, createdAt: now }]);
        await profile.save();

        // Send notification to driver (in-app)
        try {
          await InAppNotification.create({ userId: driverId, type: 'driver.verification', title: 'Verification approved', body: 'Your verification documents have been approved.', data: { decision: 'approved' }, correlationId: req.correlationId });
        } catch (e) { console.warn('[InternalController] Failed to create in-app notification for approval', e.message); }

        return res.status(200).json({ driverId, status: 'verified', decisionAt: profile.decisionAt, reviewedBy: profile.reviewedBy });
      }

      // action === 'reject'
      if (action === 'reject') {
        // reason is required by validation schema; include check defensively
        if (!reason || String(reason).trim().length === 0) {
          return res.status(400).json({ code: 'invalid_schema', message: 'Missing or invalid reason', correlationId: req.correlationId });
        }

        profile.status = 'rejected';
        profile.decisionAt = now;
        profile.reviewedBy = adminId;
        profile.rejectionReason = reason;
        profile.adminNotes = (profile.adminNotes || []).concat([{ adminId, notes: comment || reason, createdAt: now }]);
        await profile.save();

        // Send notification to driver (in-app)
        try {
          await InAppNotification.create({ userId: driverId, type: 'driver.verification', title: 'Verification rejected', body: `Your verification was rejected: ${reason}`, data: { decision: 'rejected', reason }, correlationId: req.correlationId });
        } catch (e) { console.warn('[InternalController] Failed to create in-app notification for rejection', e.message); }

        return res.status(200).json({ driverId, status: 'rejected', reason: profile.rejectionReason, decisionAt: profile.decisionAt, reviewedBy: profile.reviewedBy });
      }

      // Should not reach: action already validated
      return res.status(400).json({ code: 'invalid_schema', message: 'Unsupported action', correlationId: req.correlationId });
    } catch (err) {
      console.error('[InternalController] reviewDriverVerification failed', err);
      next(err);
    }
  }

      /**
       * GET /admin/drivers/:driverId/verification/documents/:docType/url
       * Generates a short-lived, single-use preview URL for admins to view a stored document.
       */
      async generateDocumentPreviewUrl(req, res, next) {
        try {
          const adminId = req.user.sub || req.user.id;
          const { driverId, docType } = req.params;
          const correlationId = req.correlationId;

          console.log(`[InternalController] Generate document preview URL | driverId: ${driverId} | docType: ${docType} | adminId: ${adminId} | correlationId: ${correlationId}`);

          // Validate docType
          const allowed = ['govIdFront','govIdBack','driverLicense','soat'];
          if (!allowed.includes(docType)) return res.status(400).json({ code: 'invalid_schema', message: 'Invalid document type', correlationId });

          // Load verification profile
          const profile = await DriverVerification.findOne({ userId: driverId }).lean();
          if (!profile) return res.status(404).json({ code: 'not_found', message: 'Verification profile not found', correlationId });

          const doc = profile.documents && profile.documents[docType];
          if (!doc || !doc.storagePath) return res.status(404).json({ code: 'not_found', message: 'Document not found for this driver', correlationId });

          // Create single-use token and DB record
          const crypto = require('crypto');
          const token = crypto.randomBytes(32).toString('hex');
          const ttlSeconds = 60; // short-lived
          const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

          await DocumentPreview.create({ token, driverId, docType, createdBy: adminId, createdAt: new Date(), expiresAt, used: false });

          // Build URL to preview endpoint (proxied through app)
          const url = `${req.protocol}://${req.get('host')}/internal/previews/${token}`;

          return res.status(200).json({ url, expiresInSeconds: ttlSeconds });
        } catch (err) {
          console.error('[InternalController] generateDocumentPreviewUrl failed', err);
          next(err);
        }
      }

      /**
       * GET /internal/previews/:token
       * Public endpoint that serves the document if token is valid, not expired and not used.
       * Marks the token as used and records accessor info for audit.
       */
      async servePreviewByToken(req, res, next) {
        try {
          const { token } = req.params;
          const record = await DocumentPreview.findOne({ token });
          if (!record) return res.status(404).json({ code: 'not_found', message: 'Preview not found' });

          const now = new Date();
          if (record.used || record.expiresAt < now) {
            return res.status(404).json({ code: 'not_found', message: 'Preview expired or already used' });
          }

          // Load document path
          const profile = await DriverVerification.findOne({ userId: record.driverId }).lean();
          if (!profile) return res.status(404).json({ code: 'not_found', message: 'Driver or document not found' });
          const doc = profile.documents && profile.documents[record.docType];
          if (!doc || !doc.storagePath) return res.status(404).json({ code: 'not_found', message: 'Document not found for this driver' });

          const fs = require('fs');
          const path = require('path');
          const mime = require('mime-types');

          const filePath = doc.storagePath;
          if (!fs.existsSync(filePath)) return res.status(404).json({ code: 'not_found', message: 'Document file missing' });

          // Mark token as used (best-effort before streaming)
          record.used = true;
          record.usedAt = now;
          record.accessorIp = req.ip || req.connection.remoteAddress;
          record.accessorUserAgent = req.get('User-Agent') || '';
          await record.save();

          // Stream file to client without exposing storage info
          const filename = path.basename(filePath);
          const contentType = mime.lookup(filename) || 'application/octet-stream';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

          const stream = fs.createReadStream(filePath);
          stream.on('error', (err) => { console.error('[InternalController] preview stream error', err); next(err); });
          stream.pipe(res);
        } catch (err) {
          console.error('[InternalController] servePreviewByToken failed', err);
          next(err);
        }
      }
}

module.exports = new InternalController();
