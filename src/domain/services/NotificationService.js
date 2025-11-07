/**
 * NotificationService
 * 
 * Service for creating in-app notifications automatically.
 * Handles notification creation with proper error handling (failures don't break main flow).
 */

const InAppNotification = require('../../infrastructure/database/models/InAppNotificationModel');

class NotificationService {
  /**
   * Create an in-app notification
   * 
   * @param {string} userId - User ID to notify
   * @param {string} type - Notification type (e.g., 'booking.accepted', 'trip.canceled')
   * @param {string} title - Notification title
   * @param {string} body - Notification body/message
   * @param {Object} data - Additional data/metadata
   * @param {string} correlationId - Optional correlation ID for tracking
   * @returns {Promise<Object|null>} Created notification or null if failed
   */
  static async createNotification(userId, type, title, body = '', data = {}, correlationId = null) {
    try {
      if (!userId || !type || !title) {
        console.warn('[NotificationService] Missing required fields for notification', { userId, type, title });
        return null;
      }

      const notification = await InAppNotification.create({
        userId,
        type,
        title,
        body,
        data,
        correlationId,
        isRead: false
      });

      console.log(`[NotificationService] Notification created | userId: ${userId} | type: ${type} | id: ${notification._id}`);
      return notification;
    } catch (error) {
      // Don't throw - notification failures shouldn't break main business logic
      console.error(`[NotificationService] Failed to create notification | userId: ${userId} | type: ${type}`, error.message);
      return null;
    }
  }

  /**
   * Create multiple notifications (e.g., when a trip is canceled for all passengers)
   * 
   * @param {Array<string>} userIds - Array of user IDs to notify
   * @param {string} type - Notification type
   * @param {string} title - Notification title
   * @param {string} body - Notification body/message
   * @param {Object} data - Additional data/metadata
   * @param {string} correlationId - Optional correlation ID
   * @returns {Promise<number>} Number of notifications successfully created
   */
  static async createNotifications(userIds, type, title, body = '', data = {}, correlationId = null) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return 0;
    }

    let successCount = 0;
    const notifications = userIds.map(userId => ({
      userId,
      type,
      title,
      body,
      data,
      correlationId,
      isRead: false
    }));

    try {
      const result = await InAppNotification.insertMany(notifications, { ordered: false });
      successCount = result.length;
      console.log(`[NotificationService] Created ${successCount} notifications | type: ${type} | total users: ${userIds.length}`);
    } catch (error) {
      // insertMany may partially succeed - count successful insertions
      if (error.writeErrors) {
        successCount = userIds.length - error.writeErrors.length;
        console.warn(`[NotificationService] Partial success creating notifications | succeeded: ${successCount} | failed: ${error.writeErrors.length}`);
      } else {
        console.error(`[NotificationService] Failed to create notifications | type: ${type}`, error.message);
      }
    }

    return successCount;
  }
}

module.exports = NotificationService;

