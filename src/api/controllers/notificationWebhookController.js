const emailProvider = require('../../infrastructure/notificationProviders/emailProvider');
const DeliveryAttempt = require('../../infrastructure/database/models/DeliveryAttemptModel');
const NotificationDelivery = require('../../infrastructure/database/models/NotificationDeliveryModel');
const InAppNotification = require('../../infrastructure/database/models/InAppNotificationModel');
const notificationMetrics = require('../../domain/services/notificationMetrics');

function redactEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const parts = email.split('@');
  if (parts.length !== 2) return 'REDACTED';
  const local = parts[0];
  const domain = parts[1];
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

function redactRaw(raw) {
  try {
    const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // remove email addresses
    return s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED]');
  } catch (e) {
    return '[REDACTED]';
  }
}

class NotificationWebhookController {
  constructor() {}

  async handleEmailWebhook(req, res) {
    // Read raw body collected by rawBody middleware
    const raw = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
    const sigHeader = req.headers['x-provider-signature'] || req.headers['x-sendgrid-signature'] || req.headers['x-signature'];

    let evt;
    try {
      evt = emailProvider.verifyAndParse(raw, sigHeader);
    } catch (err) {
      console.warn('[NotificationWebhook] Invalid signature or payload:', err.message);
      return res.status(400).json({ code: 'invalid_signature', message: 'Webhook signature verification failed' });
    }

    // Normalize
    const providerMessageId = evt.providerMessageId;
    if (!providerMessageId) {
      console.warn('[NotificationWebhook] Missing providerMessageId in payload');
      return res.status(202).json({ ok: true });
    }

    const now = new Date();

    // Try to resolve linked notification id from metadata.notificationId
    let linkedNotificationId = null;
    try {
      if (evt.metadata && evt.metadata.notificationId) {
        const maybe = evt.metadata.notificationId;
        // If looks like an ObjectId hex string, use directly
        if (/^[0-9a-fA-F]{24}$/.test(maybe)) {
          linkedNotificationId = maybe;
        } else {
          // Try to parse if prefixed (e.g., n_66c1) — attempt to find by string id
          const found = await InAppNotification.findOne({ _id: maybe });
          if (found) linkedNotificationId = found._id;
        }
      }
    } catch (e) {
      // ignore resolution errors
      linkedNotificationId = null;
    }

    // Upsert NotificationDelivery (idempotent by providerMessageId)
    try {
      const statusMap = {
        delivered: 'delivered',
        bounced: 'bounced',
        complained: 'complained',
        dropped: 'dropped'
      };

      const status = statusMap[evt.eventType] || 'pending';

      const ndUpdate = {
        $set: {
          status,
          lastEventAt: now,
          meta: Object.assign({}, evt.metadata || {})
        },
        $inc: { attempts: 1 },
        $addToSet: { processedEvents: evt.providerEventId || evt.providerMessageId }
      };
      if (linkedNotificationId) ndUpdate.$set.notificationId = linkedNotificationId;

      // Fire-and-forget: don't block webhook response on DB availability; log any errors
      NotificationDelivery.findOneAndUpdate({ providerMessageId }, ndUpdate, { upsert: true, new: true })
        .then(async (nd) => {
          // update metrics based on status if we have intentType
          try {
            const intentType = (nd && nd.meta && nd.meta.intentType) || (evt.metadata && evt.metadata.intentType) || evt.metadata && evt.metadata.type;
            if (intentType) {
              const d = {};
              if (status === 'delivered') d.delivered = 1;
              if (status === 'bounced') d.bounced = 1;
              if (status === 'complained') d.complained = 1;
              if (Object.keys(d).length > 0) {
                await notificationMetrics.increment({ type: intentType, channel: 'email', deltas: d });
              }
            }
          } catch (err) {
            console.error('[NotificationWebhook] metrics increment failed:', err);
          }
        })
        .catch(err => console.error('[NotificationWebhook] Error upserting NotificationDelivery:', err));
    } catch (err) {
      console.error('[NotificationWebhook] Error upserting NotificationDelivery:', err);
      // don't crash — continue to record delivery attempt
    }

    // Upsert a DeliveryAttempt record keyed by providerMessageId (idempotent)
    try {
      const attempt = {
        providerMessageId,
        providerEventId: evt.providerEventId || null,
        eventType: evt.eventType,
        recipientRedacted: redactEmail(evt.recipient),
        metadata: evt.metadata || {},
        raw: redactRaw(evt.raw)
      };

      DeliveryAttempt.findOneAndUpdate(
        { providerMessageId },
        { $set: attempt },
        { upsert: true, new: true }
      ).catch(err => console.error('[NotificationWebhook] Error upserting DeliveryAttempt:', err));
    } catch (err) {
      console.error('[NotificationWebhook] Error upserting DeliveryAttempt:', err);
    }

    // Fast 200 response — heavy processing should be queued if needed
    return res.json({ ok: true });
  }
}

module.exports = NotificationWebhookController;
