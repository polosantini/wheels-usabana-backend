const DriverVerification = require('../../infrastructure/database/models/DriverVerificationModel');
const InAppNotification = require('../../infrastructure/database/models/InAppNotificationModel');

/**
 * Runs an expiry scan over DriverVerification profiles.
 * - flips verified -> expired when license or soat expired
 * - sends reminders at configured windows (days before expiry)
 *
 * Returns: { processed, newlyExpired, remindersSent: { '30d': n, '7d': n, '1d': n } }
 */
class VerificationExpiryService {
  constructor() {}

  async runExpiryScan({ windowsDays = [30, 7, 1], now = new Date() } = {}) {
    const processed = { count: 0 };
    let newlyExpired = 0;
    const remindersSent = {};
    // normalize windows to numbers and sort descending
    const windows = Array.from(new Set(windowsDays.map(d => parseInt(d, 10)).filter(Boolean))).sort((a,b) => b - a);
    windows.forEach(w => { remindersSent[`${w}d`] = 0; });

    // Find all verified profiles
    const cursor = DriverVerification.find({ status: 'verified' }).cursor();
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      processed.count += 1;

      // determine earliest expiry among driverLicense and soat
      const licenseExpiry = doc.documents && doc.documents.driverLicense && doc.documents.driverLicense.expiresAt ? new Date(doc.documents.driverLicense.expiresAt) : null;
      const soatExpiry = doc.documents && doc.documents.soat && doc.documents.soat.expiresAt ? new Date(doc.documents.soat.expiresAt) : null;
      const expiries = [licenseExpiry, soatExpiry].filter(Boolean);
      if (expiries.length === 0) {
        // No expiry info; skip
        continue;
      }

      const nearestExpiry = new Date(Math.min.apply(null, expiries.map(d => d.getTime())));

      if (now > nearestExpiry) {
        // expired -> mark as expired
        doc.status = 'expired';
        doc.lastUpdatedAt = now;
        // push admin note
        doc.adminNotes = (doc.adminNotes || []).concat([{ adminId: 'system', notes: 'Auto-expired by expiry scan', createdAt: now }]);
        await doc.save();
        newlyExpired += 1;
        continue;
      }

      // compute days until expiry (ceil)
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysUntil = Math.ceil((nearestExpiry.getTime() - now.getTime()) / msPerDay);

      // For each window, if within window and not already sent, send reminder
      for (const w of windows) {
        const key = `${w}d`;
        if (daysUntil <= w) {
          // check remindersSent on doc
          const already = (doc.remindersSent || []).some(r => r.window === key);
          if (!already) {
            // send in-app reminder
            try {
              await InAppNotification.create({ userId: doc.userId, type: 'driver.verification.reminder', title: 'Verification expiring soon', body: `Your verification documents expire in ${daysUntil} day(s). Please renew.`, data: { daysUntil, window: key } });
            } catch (e) { console.warn('[VerificationExpiryService] Failed to create in-app reminder', e && e.message); }

            // record reminder
            doc.remindersSent = (doc.remindersSent || []).concat([{ window: key, sentAt: now }]);
            remindersSent[key] = (remindersSent[key] || 0) + 1;
            // save single update to persist reminder
            try { await doc.save(); } catch (e) { console.warn('[VerificationExpiryService] failed saving reminder mark', e && e.message); }
          }
        }
      }
    }

    return { processed: processed.count, newlyExpired, remindersSent };
  }
}

module.exports = new VerificationExpiryService();
